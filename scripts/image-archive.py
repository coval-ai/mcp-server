"""Bind a saved Docker image to its qualified platform and deterministic publication bytes."""
import argparse
from contextlib import ExitStack
import gzip
import hashlib
import io
import json
import re
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE = 2 * 1024**3
MAX_LAYER = 1024**3
MAX_TOTAL_UNCOMPRESSED = 2 * 1024**3
MAX_METADATA = 1024**2
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
INDEX = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
DOCKER_CONFIG = "application/vnd.docker.container.image.v1+json"
DOCKER_LAYER = "application/vnd.docker.image.rootfs.diff.tar.gzip"


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def file_sha(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode()


def unique_object(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def parse(data):
    require(len(data) <= MAX_METADATA, "Oversized image metadata")
    return json.loads(data, object_pairs_hook=unique_object)


def safe_path(name):
    require(isinstance(name, str) and name and "\\" not in name and ":" not in name,
            "Unsafe archive path")
    parts = name.rstrip("/").split("/")
    require(all(part not in ("", ".", "..") for part in parts) and not PurePosixPath(name).is_absolute(),
            "Unsafe archive path")
    return name.rstrip("/")


class Archive:
    def __init__(self, path):
        require(Path(path).stat().st_size <= MAX_ARCHIVE, "Oversized image archive")
        self.tar = tarfile.open(path, "r:")
        self.entries = {}
        try:
            for entry in self.tar:
                name = safe_path(entry.name)
                require(name not in self.entries, "Duplicate archive entry")
                require((entry.isfile() or entry.isdir()) and entry.sparse is None, "Links and special archive entries are refused")
                require(entry.size <= MAX_LAYER, "Oversized archive entry")
                self.entries[name] = entry
                require(len(self.entries) <= 4096, "Too many archive entries")
        except BaseException:
            self.tar.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.tar.close()

    def member(self, name):
        entry = self.entries.get(safe_path(name))
        require(entry is not None and entry.isfile(), "Missing regular archive entry")
        return entry

    def read(self, name):
        entry = self.member(name)
        require(entry.size <= MAX_METADATA, "Oversized image metadata")
        return self.tar.extractfile(entry).read(MAX_METADATA + 1)

    def descriptor(self, descriptor):
        require(isinstance(descriptor, dict) and DIGEST.fullmatch(descriptor.get("digest", "")), "Invalid image descriptor")
        data = self.read("blobs/sha256/" + descriptor["digest"][7:])
        require(type(descriptor.get("size")) is int and len(data) == descriptor["size"]
                and sha(data) == descriptor["digest"], "Image descriptor byte/size mismatch")
        return parse(data)


def resolve_image(archive, qualified_id):
    """Resolve an authenticated Docker ID, not an arbitrary config named by the tar."""
    require(DIGEST.fullmatch(qualified_id or ""), "Invalid qualified Docker ID")
    records = parse(archive.read("manifest.json"))
    require(isinstance(records, list) and len(records) == 1, "Expected one Docker image")
    record = records[0]
    config_bytes = archive.read(record["Config"])
    config_digest = sha(config_bytes)
    config = parse(config_bytes)
    require(config.get("os") == "linux" and config.get("architecture") == "amd64",
            "Only linux/amd64 images are qualified")
    layers = record.get("Layers")
    require(isinstance(layers, list) and 0 < len(layers) <= 128 and all(isinstance(x, str) for x in layers),
            "Invalid ordered Docker layers")
    for name in layers:
        archive.member(name)
    platform_manifest = None
    platform_digest = None
    if qualified_id != config_digest:
        root_bytes = archive.read("blobs/sha256/" + qualified_id[7:])
        require(sha(root_bytes) == qualified_id, "Qualified Docker root digest mismatch")
        root = parse(root_bytes)
        if root.get("mediaType") in INDEX:
            matches = [x for x in root.get("manifests", [])
                       if x.get("platform", {}).get("os") == "linux"
                       and x.get("platform", {}).get("architecture") == "amd64"
                       and not x.get("platform", {}).get("variant")]
            require(len(matches) == 1, "Ambiguous or missing linux/amd64 platform")
            platform_digest = matches[0]["digest"]
            platform_manifest = archive.descriptor(matches[0])
        else:
            platform_manifest, platform_digest = root, qualified_id
        require(platform_manifest.get("schemaVersion") == 2 and platform_manifest.get("mediaType") in IMAGE,
                "Unsupported selected platform manifest")
        descriptor = platform_manifest.get("config", {})
        require(descriptor.get("mediaType") in {DOCKER_CONFIG, "application/vnd.oci.image.config.v1+json"}
                and descriptor.get("digest") == config_digest and descriptor.get("size") == len(config_bytes),
                "Platform config differs from saved Docker image")
        require(len(platform_manifest.get("layers", [])) == len(layers), "Platform layer count mismatch")
    return record, config_bytes, config_digest, config, platform_manifest, platform_digest


def _prepare(archive, archive_path, inspect, output_directory, qualification):
    require(inspect.get("Os") == "linux" and inspect.get("Architecture") == "amd64", "Wrong Docker inspection platform")
    record, config_bytes, config_digest, config, selected, selected_digest = resolve_image(archive, inspect.get("Id"))
    require(config.get("config") == inspect.get("Config"), "Docker execution configuration mismatch")
    diffs = config.get("rootfs", {}).get("diff_ids")
    require(config.get("rootfs", {}).get("type") == "layers" and isinstance(diffs, list)
            and diffs == inspect.get("RootFS", {}).get("Layers") and len(diffs) == len(record["Layers"]),
            "Docker root filesystem differs from archive")
    require(qualification.get("schema") == "coval-mcp-image-qualification-v1"
            and qualification.get("dockerId") == inspect.get("Id")
            and qualification.get("platform") == "linux/amd64", "Qualification identity mismatch")
    source, environment = qualification.get("source"), qualification.get("environment")
    require(isinstance(source, str) and re.fullmatch("[0-9a-f]{40}", source)
            and environment in ("staging", "v1"), "Invalid qualification source/environment")
    runtime = config.get("config", {})
    require(runtime.get("Labels", {}).get("org.opencontainers.image.revision") == source,
            "Qualified source label differs from archive")
    for key, expected in [("COVAL_MCP_SOURCE_SHA", source), ("DD_ENV", environment)]:
        require([x for x in runtime.get("Env", []) if x.startswith(key + "=")] == [key + "=" + expected],
                "Qualified environment differs from archive")
    profiles = qualification.get("profiles")
    require(isinstance(profiles, dict) and set(profiles) == {"standard", "claude"}, "Incomplete protocol qualification")
    for profile in profiles.values():
        require(profile.get("image") == inspect["Id"], "Protocol qualifier ran a different image")
        descriptor = profile.get("manifest")
        if selected:
            require(isinstance(descriptor, dict) and descriptor.get("digest") == selected_digest
                    and descriptor.get("platform", {}).get("os") == "linux"
                    and descriptor.get("platform", {}).get("architecture") == "amd64"
                    and not descriptor.get("platform", {}).get("variant")
                    and archive.descriptor(descriptor) == selected, "Protocol qualifier selected a different manifest")
        else:
            require(descriptor is None, "Unproven classic-store platform descriptor")
    out = Path(output_directory)
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    descriptors, layer_files = [], {}
    try:
        with tempfile.TemporaryDirectory(prefix="mcp-image-layers-") as directory:
            total_uncompressed = 0
            for index, name in enumerate(record["Layers"]):
                entry = archive.member(name)
                raw_path = Path(directory) / f"raw-{index}"
                with archive.tar.extractfile(entry) as source, raw_path.open("wb") as target:
                    shutil.copyfileobj(source, target, 1024**2)
                raw_digest = "sha256:" + file_sha(raw_path)
                if selected:
                    descriptor = selected["layers"][index]
                    require(descriptor.get("digest") == raw_digest and descriptor.get("size") == entry.size,
                            "Selected platform layer digest/size mismatch")
                with raw_path.open("rb") as raw:
                    compressed = raw.read(2) == b"\x1f\x8b"
                diff_hash, count = hashlib.sha256(), 0
                normalized = raw_path if compressed else Path(directory) / f"gzip-{index}"
                if selected:
                    expected_type = "application/vnd.oci.image.layer.v1.tar+gzip" if compressed else "application/vnd.oci.image.layer.v1.tar"
                    require(selected["layers"][index].get("mediaType") in ({expected_type, DOCKER_LAYER} if compressed else {expected_type}),
                            "Selected layer encoding differs from descriptor")
                with ExitStack() as stack:
                    source = stack.enter_context(gzip.open(raw_path, "rb") if compressed else raw_path.open("rb"))
                    target = None
                    if not compressed:
                        output = stack.enter_context(normalized.open("wb"))
                        target = stack.enter_context(gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0))
                    while chunk := source.read(1024**2):
                        count += len(chunk)
                        total_uncompressed += len(chunk)
                        require(count <= MAX_LAYER and total_uncompressed <= MAX_TOTAL_UNCOMPRESSED,
                                "Oversized uncompressed layer or total image")
                        diff_hash.update(chunk)
                        if target:
                            target.write(chunk)
                require("sha256:" + diff_hash.hexdigest() == diffs[index], "Layer bytes differ from qualified root filesystem")
                layer_digest = "sha256:" + file_sha(normalized)
                size = normalized.stat().st_size
                descriptors.append({"mediaType": DOCKER_LAYER, "size": size, "digest": layer_digest})
                layer_files.setdefault(layer_digest, normalized)
            manifest = {"schemaVersion": 2, "mediaType": DOCKER_MANIFEST,
                        "config": {"mediaType": DOCKER_CONFIG, "size": len(config_bytes), "digest": config_digest},
                        "layers": descriptors}
            manifest_bytes = compact(manifest)
            config_name = config_digest[7:] + ".json"
            docker_record = {"Config": config_name, "RepoTags": [],
                             "Layers": [x["digest"][7:] + ".tar.gz" for x in descriptors]}
            with tarfile.open(out / "mcp-publication-image.tar", "w", format=tarfile.USTAR_FORMAT) as target_tar:
                def add_bytes(name, data):
                    info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644
                    target_tar.addfile(info, io.BytesIO(data))
                add_bytes(config_name, config_bytes)
                for digest in sorted(layer_files):
                    file = layer_files[digest]
                    info = tarfile.TarInfo(digest[7:] + ".tar.gz"); info.size = file.stat().st_size; info.mode = 0o644
                    with file.open("rb") as source:
                        target_tar.addfile(info, source)
                add_bytes("manifest.json", compact([docker_record]))
            identity = {"qualifiedDockerId": inspect["Id"], "platformManifestDigest": selected_digest,
                        "configDigest": config_digest, "manifestDigest": sha(manifest_bytes),
                        "archiveSha256": file_sha(archive_path),
                        "publicationArchiveSha256": file_sha(out / "mcp-publication-image.tar")}
            (out / "mcp-publication-manifest.json").write_bytes(manifest_bytes)
            (out / "archive-identity.json").write_bytes(compact(identity))
            return identity
    except Exception:
        shutil.rmtree(out)
        raise
    finally:
        archive.tar.close()


def prepare(archive_path, inspect, output_directory, qualification):
    with Archive(archive_path) as archive:
        return _prepare(archive, archive_path, inspect, output_directory, qualification)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive"); parser.add_argument("inspection"); parser.add_argument("qualification"); parser.add_argument("output")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.archive, parse(Path(args.inspection).read_bytes()), args.output, parse(Path(args.qualification).read_bytes()))))
    except Exception as error:
        raise SystemExit("Qualified image archive verification failed: " + str(error))
