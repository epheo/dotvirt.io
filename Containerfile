# Plain files: KISS serves /content on 8080 with /health and /ready,
# which the static-site base in defms-k8s-gitops probes.
# Pinned: the demo video needs Range requests, which older builds lack.
FROM quay.io/epheo/kiss@sha256:04c6f49c12029696a13be1a51252ff459a8fa4483a12047cc994dc183ecd0a7d
COPY site/ /content/
