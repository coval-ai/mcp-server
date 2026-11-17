# Containerd image identity regression

These non-secret export metadata files preserve a real containerd Docker image shape: Docker inspection names the OCI index, the unique linux/amd64 platform selects an OCI manifest, and that manifest names a different config digest. The Docker-save compatibility manifest selects the same config and ordered layers. All metadata hashes are asserted in the regression.

Only metadata is committed. The metadata-resolution test deliberately uses layer placeholders and does not claim payload qualification. Full graph/layer validation is covered by self-contained generated archives and was also replayed offline against the original captured image archive with checksum-pinned crane. Runtime/config labels and build history come from the public Dockerfile and source; no runtime-injected credentials are included.
