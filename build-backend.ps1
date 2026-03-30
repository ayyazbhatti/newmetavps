# Build the Rust backend. Requires Visual Studio Build Tools with C++ workload.
# If you see "link.exe not found", install: https://visualstudio.microsoft.com/visual-cpp-build-tools/
Set-Location C:\metabot
cargo build --release --manifest-path backend/Cargo.toml
