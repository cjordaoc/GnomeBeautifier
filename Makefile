UUID         := gnomebeautifier@caio.jcalisto
SRC_DIR      := src
DIST_DIR     := dist
SCHEMA_REL   := schemas/org.gnome.shell.extensions.gnomebeautifier.gschema.xml
SCHEMA_FILE  := $(SRC_DIR)/$(SCHEMA_REL)
ZIP          := $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: all pack install enable disable reinstall lint validate verify-prefs verify-resources clean

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

verify-resources:
	@echo "Checking every resource:// import in src/ resolves against the installed gresource bundles..."
	@bad=0; for path in $$(grep -hroE "resource:///[A-Za-z0-9/_.-]+" $(SRC_DIR) | sort -u); do \
		rel=$${path#resource://}; \
		hit=$$(for gres in /usr/share/gnome-shell/*.gresource /usr/lib/gnome-shell/*.so /usr/lib/*/gnome-shell/*.so /usr/bin/gnome-shell; do \
			[ -f "$$gres" ] && gresource list "$$gres" 2>/dev/null | grep -qx "$$rel" && echo "$$gres" && break; \
		done); \
		if [ -z "$$hit" ]; then \
			echo "  MISSING: $$path"; bad=1; \
		else \
			echo "  OK      $$path"; \
		fi; \
	done; \
	exit $$bad

verify-prefs: install
	@echo "Opening prefs window to catch import errors interactively..."
	gnome-extensions prefs $(UUID)

clean:
	rm -rf $(DIST_DIR)
