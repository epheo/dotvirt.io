# dotvirt.io

Source of https://dotvirt.io, the landing page of [dotvirt](https://github.com/epheo/dotvirt).

## Layout

- `site/`: static files, served verbatim
- `tools/showcase.mjs`: dotvirt's fixture backend on a demo fleet
- `tools/shots.mjs`: the screenshots, captured from that fixture
- `tools/og.mjs`: the link-preview card
- `Containerfile`: `site/` on `quay.io/epheo/kiss`

## Preview

```
make serve    # http://localhost:8080, restart after an edit (kiss caches at start)
```

## Screenshots

Nothing here talks to a cluster.
The UI is the real one, the data is scripted.

```
(cd ../dotvirt/web && npm run build)
make fixture                # terminal 1
make shots og               # terminal 2, needs ffmpeg with libwebp
```

The demo video comes from the recorder in `../dotvirt-demo`.
`site/media` holds its H.264 cut and a VP9 one for browsers without H.264.
Chapter links in `site/index.html` are seconds into that cut.

## Publish

Push to `main`.
GitHub Actions pushes `ghcr.io/epheo/dotvirt-io:<sha>`.
Bump that tag in `applications/dotvirt-io` of the defms gitops repo and ArgoCD rolls it out.

## License

Apache License 2.0, see `LICENSE.md`.
Fonts are Red Hat Display, Text and Mono under the SIL Open Font License, see `site/fonts/OFL.txt`.
