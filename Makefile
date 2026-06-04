BINARY := branchterm
INSTALL_DIR := $(HOME)/.local/bin

.PHONY: install update build

install: build
	@mkdir -p $(INSTALL_DIR)
	cp src-tauri/target/release/$(BINARY) $(INSTALL_DIR)/.$(BINARY)-bin
	@rm -f $(INSTALL_DIR)/$(BINARY)
	@printf '#!/bin/sh\nnohup "$(INSTALL_DIR)/.$(BINARY)-bin" "$$@" >/dev/null 2>&1 &\ndisown\n' > $(INSTALL_DIR)/$(BINARY)
	chmod +x $(INSTALL_DIR)/$(BINARY)
	@echo "Installed to $(INSTALL_DIR)/$(BINARY)"

build:
	npm install
	npm run tauri build -- --no-bundle

update: install
