# Plain files: KISS serves /content on 8080 with /health and /ready,
# which the static-site base in defms-k8s-gitops probes.
FROM quay.io/epheo/kiss:0.4.0
COPY site/ /content/
