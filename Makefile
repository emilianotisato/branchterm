BINARY := branchterm
INSTALL_DIR := $(HOME)/.local/bin

.PHONY: install update

install: build
	@mkdir -p $(INSTALL_DIR)
	cp src-tauri/target/release/$(BINARY) $(INSTALL_DIR)/$(BINARY)
	@echo "Installed to $(INSTALL_DIR)/$(BINARY)"

build:
	npm install
	npm run tauri build

update: install
