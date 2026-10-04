.PHONY: serve image fixture shots og

DOTVIRT ?= ../dotvirt
FFMPEG  ?= ffmpeg
KISS    ?= quay.io/epheo/kiss:0.4.0
PORT    ?= 8080

serve:
	podman run --rm -p $(PORT):8080 -v ./site:/content:ro,z $(KISS)

image:
	podman build -t dotvirt-io .

# Needs `npm run build` done in $(DOTVIRT)/web.
fixture:
	DOTVIRT=$(DOTVIRT) node tools/showcase.mjs

# Needs `make fixture` running. Lossless WebP: UI text smears under lossy.
shots:
	rm -rf shots
	DOTVIRT=$(DOTVIRT) node tools/shots.mjs shots
	for f in shots/*.png; do \
		$(FFMPEG) -hide_banner -loglevel error -y -i $$f \
			-c:v libwebp -lossless 1 -compression_level 6 site/img/$$(basename $$f .png).webp; \
	done
	rm -rf shots

og:
	DOTVIRT=$(DOTVIRT) node tools/og.mjs
