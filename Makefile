UUID         := gnomebeautifier@caio.jcalisto
SRC_DIR      := src
DIST_DIR     := dist
SCHEMA_REL   := schemas/org.gnome.shell.extensions.gnomebeautifier.gschema.xml
SCHEMA_FILE  := $(SRC_DIR)/$(SCHEMA_REL)
ZIP          := $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: all pack install enable disable reinstall lint validate clean

all: pack

$(DIST_DIR):
	@mkdir -p $(DIST_DIR)

pack: lint $(DIST_DIR)
	gnome-extensions pack $(SRC_DIR) \
		--schema=$(SCHEMA_REL) \
		--extra-source=modules \
		-o $(DIST_DIR) \
		--force

install: pack
	gnome-extensions install --force $(ZIP)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID) || true

reinstall: disable install enable

lint:
	@python3 -c "import json; json.load(open('$(SRC_DIR)/metadata.json'))"
	@glib-compile-schemas --strict --dry-run $(SRC_DIR)/schemas/
	@echo "lint: metadata.json + gschema OK"

validate: pack
	@unzip -l $(ZIP)

clean:
	rm -rf $(DIST_DIR)
