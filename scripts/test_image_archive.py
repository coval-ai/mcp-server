import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("image_archive", Path(__file__).with_name("image-archive.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = "a" * 40


def layer(content):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as t:
        info = tarfile.TarInfo("file"); info.size = len(content)
        t.addfile(info, io.BytesIO(content))
    return stream.getvalue()


class Fixture:
    def __init__(self, classic=False, compressed=True):
        self.raw = [layer(b"one"), layer(b"two")]
        self.payloads = [gzip.compress(x, mtime=0) if compressed else x for x in self.raw]
        runtime = {"Env": ["COVAL_MCP_SOURCE_SHA=" + SOURCE, "DD_ENV=staging"],
                   "Labels": {"org.opencontainers.image.revision": SOURCE}, "Cmd": ["node", "dist/remote.js"]}
        self.config = {"architecture": "amd64", "os": "linux", "config": runtime,
                       "rootfs": {"type": "layers", "diff_ids": [m.sha(x) for x in self.raw]}}
        config_bytes = m.compact(self.config)
        self.config_digest = m.sha(config_bytes)
        config_path = "blobs/sha256/" + self.config_digest[7:]
        self.layer_paths = ["blobs/sha256/" + m.sha(x)[7:] for x in self.payloads]
        self.entries = {config_path: config_bytes, **dict(zip(self.layer_paths, self.payloads))}
        self.selected = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                         "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "size": len(config_bytes), "digest": self.config_digest},
                         "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip" if compressed else "application/vnd.oci.image.layer.v1.tar", "size": len(x), "digest": m.sha(x)} for x in self.payloads]}
        selected_bytes = m.compact(self.selected)
        self.selected_digest = m.sha(selected_bytes)
        self.entries["blobs/sha256/" + self.selected_digest[7:]] = selected_bytes
        descriptor = {"mediaType": self.selected["mediaType"], "size": len(selected_bytes),
                      "digest": self.selected_digest, "platform": {"os": "linux", "architecture": "amd64"}}
        self.index = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": [descriptor]}
        index_bytes = m.compact(self.index)
        self.root_digest = m.sha(index_bytes)
        self.entries["blobs/sha256/" + self.root_digest[7:]] = index_bytes
        self.record = {"Config": config_path, "RepoTags": ["example:qualified"], "Layers": self.layer_paths}
        self.entries["manifest.json"] = m.compact([self.record])
        self.inspect = {"Id": self.config_digest if classic else self.root_digest, "Os": "linux", "Architecture": "amd64",
                        "Config": runtime, "RootFS": {"Layers": self.config["rootfs"]["diff_ids"]}}
        self.qualification = {"schema": "coval-mcp-image-qualification-v1", "dockerId": self.inspect["Id"],
                              "platform": "linux/amd64", "source": SOURCE, "environment": "staging",
                              "profiles": {x: {"image": self.inspect["Id"], "manifest": None if classic else descriptor} for x in ["standard", "claude"]}}

    def write(self, root, extra=None):
        path = root / "image.tar"
        with tarfile.open(path, "w") as t:
            for name, data in self.entries.items():
                info = tarfile.TarInfo(name); info.size = len(data)
                t.addfile(info, io.BytesIO(data))
            if extra:
                info, data = extra
                t.addfile(info, io.BytesIO(data) if data else None)
        return path

    def prepare(self, root, extra=None):
        return m.prepare(self.write(root, extra), self.inspect, root / "publication", self.qualification)

    def replace_index(self, index):
        raw = m.compact(index); digest = m.sha(raw)
        self.entries["blobs/sha256/" + digest[7:]] = raw
        self.inspect["Id"] = digest
        self.qualification["dockerId"] = digest
        for p in self.qualification["profiles"].values():
            p["image"] = digest


class ImageArchiveTests(unittest.TestCase):
    def test_index_and_classic_stores_bind_same_config_and_crane_manifest(self):
        for classic, compressed in [(False, True), (True, False), (True, True)]:
            with self.subTest(classic=classic, compressed=compressed), tempfile.TemporaryDirectory() as d:
                f = Fixture(classic, compressed); root = Path(d); proof = f.prepare(root)
                self.assertEqual(proof["configDigest"], f.config_digest)
                self.assertNotEqual(proof["qualifiedDockerId"], f.config_digest) if not classic else None
                manifest = (root / "publication/mcp-publication-manifest.json").read_bytes()
                self.assertEqual(m.sha(manifest), proof["manifestDigest"])
                with tarfile.open(root / "publication/mcp-publication-image.tar") as t:
                    record = json.load(t.extractfile("manifest.json"))[0]
                    for position, name in enumerate(record["Layers"]):
                        payload = t.extractfile(name).read()
                        self.assertEqual(m.sha(payload), json.loads(manifest)["layers"][position]["digest"])
                        self.assertEqual(gzip.decompress(payload), f.raw[position])
                if os.environ.get("MCP_TEST_CRANE"):
                    actual = subprocess.check_output([os.environ["MCP_TEST_CRANE"], "digest", "--tarball", str(root / "publication/mcp-publication-image.tar")], text=True).strip()
                    self.assertEqual(actual, proof["manifestDigest"])

    def test_hybrid_view_tampering_rejected_even_with_new_outer_archive_hash(self):
        for mutation in ["payload", "reorder", "config", "size", "image", "platform", "profile", "missing-root", "duplicate-platform"]:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as d:
                f = Fixture()
                if mutation == "payload": f.entries[f.layer_paths[0]] = b"changed"
                if mutation == "reorder":
                    f.record["Layers"] = list(reversed(f.layer_paths)); f.entries["manifest.json"] = m.compact([f.record])
                if mutation == "config":
                    f.record["Config"] = "other.json"; f.entries["other.json"] = m.compact({**f.config, "created": "changed"}); f.entries["manifest.json"] = m.compact([f.record])
                if mutation == "size":
                    index = copy.deepcopy(f.index); index["manifests"][0]["size"] += 1; f.replace_index(index)
                if mutation == "image": f.inspect["Id"] = "sha256:" + "f" * 64
                if mutation == "platform":
                    index = copy.deepcopy(f.index); index["manifests"][0]["platform"]["architecture"] = "arm64"; f.replace_index(index)
                if mutation == "profile": f.qualification["profiles"]["claude"] = {"image": "sha256:" + "f" * 64, "manifest": None}
                if mutation == "missing-root": del f.entries["blobs/sha256/" + f.root_digest[7:]]
                if mutation == "duplicate-platform":
                    index = copy.deepcopy(f.index); index["manifests"].append(index["manifests"][0]); f.replace_index(index)
                root = Path(d); archive = f.write(root)
                self.assertEqual(len(m.file_sha(archive)), 64)
                with self.assertRaises((ValueError, KeyError)):
                    m.prepare(archive, f.inspect, root / "publication", f.qualification)
                self.assertFalse((root / "publication").exists())

    def test_classic_layer_diffids_are_not_assumed_from_config_id(self):
        with tempfile.TemporaryDirectory() as d:
            f = Fixture(classic=True, compressed=False); f.entries[f.layer_paths[0]] = b"changed"
            with self.assertRaisesRegex(ValueError, "Layer bytes"):
                f.prepare(Path(d))

    def test_total_decompression_and_individual_layer_budgets(self):
        for name in ["MAX_TOTAL_UNCOMPRESSED", "MAX_LAYER"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                f = Fixture()
                with patch.object(m, name, 15000 if name == "MAX_TOTAL_UNCOMPRESSED" else 5000):
                    with self.assertRaisesRegex(ValueError, "Oversized"):
                        f.prepare(Path(d))

    def test_duplicate_paths_links_and_traversal_are_refused(self):
        for kind in ["duplicate", "symlink", "hardlink", "traversal"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                f = Fixture(); info = tarfile.TarInfo("manifest.json" if kind == "duplicate" else "../escape" if kind == "traversal" else "link")
                data = b"[]" if kind in ("duplicate", "traversal") else None
                info.size = len(data or b"")
                if kind in ("symlink", "hardlink"):
                    info.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE; info.linkname = "manifest.json"
                with self.assertRaises(ValueError):
                    f.prepare(Path(d), (info, data))

    def test_archive_closed_when_resolution_fails(self):
        with tempfile.TemporaryDirectory() as d:
            f = Fixture(); f.inspect["Id"] = "sha256:" + "f" * 64
            handles = []
            original = tarfile.open
            def opened(*args, **kwargs):
                result = original(*args, **kwargs); handles.append(result); return result
            with patch.object(m.tarfile, "open", opened):
                with self.assertRaises(ValueError): f.prepare(Path(d))
            self.assertTrue(handles and all(t.closed for t in handles))

    def test_classic_output_handles_close_even_when_references_are_retained(self):
        with tempfile.TemporaryDirectory() as d:
            opened = []
            original = Path.open
            def tracked(path, *args, **kwargs):
                result = original(path, *args, **kwargs)
                if args and args[0] == "wb": opened.append(result)
                return result
            with patch.object(Path, "open", tracked):
                Fixture(classic=True, compressed=False).prepare(Path(d))
            self.assertTrue(opened and all(handle.closed for handle in opened))

    def test_actual_containerd_export_metadata_resolves_root_and_config_distinctly(self):
        root = Path(__file__).with_name("fixtures") / "containerd-image"
        manifest = json.loads((root / "docker-manifest.json").read_text())[0]
        with tempfile.TemporaryDirectory() as d:
            f = Fixture(); f.entries = {"manifest.json": m.compact([manifest])}
            for name, expected in [("index.json", "4da450547f936a5872a0185598b7db1c8596f488af0260f2b0e1e6ed2fbeeb08"), ("platform.json", "97ce1baa34b3bdf39330833da7fd81d7e41d2984b75e10c39961bf8d344d8f85"), ("config.json", "53a99ec5ecbb0f4635cf7b6e2ace09fddf82712d06c45a4fa6bd716c4fbaf5e7")]:
                raw = (root / name).read_bytes(); self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
                f.entries["blobs/sha256/" + expected] = raw
            for path in manifest["Layers"]: f.entries[path] = b"metadata-only placeholder"
            with m.Archive(f.write(Path(d))) as archive:
                resolved = m.resolve_image(archive, "sha256:4da450547f936a5872a0185598b7db1c8596f488af0260f2b0e1e6ed2fbeeb08")
            self.assertEqual(resolved[2], "sha256:53a99ec5ecbb0f4635cf7b6e2ace09fddf82712d06c45a4fa6bd716c4fbaf5e7")
            self.assertEqual(resolved[5], "sha256:97ce1baa34b3bdf39330833da7fd81d7e41d2984b75e10c39961bf8d344d8f85")


if __name__ == "__main__":
    unittest.main()
