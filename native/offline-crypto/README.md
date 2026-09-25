# Offline ShangMi worker

This statically linked, single-request Go executable supplies SM2/SM3/SM4 and SHA-3 where Electron's BoringSSL does not implement them. It reads one bounded JSON object from stdin and emits one result to stdout, then exits. No network client/server, shell execution, filesystem key lookup, logging or persistent key storage is implemented.

The algorithms are supplied by the pinned `github.com/emmansun/gmsm v0.44.1` (MIT) and Go standard library (BSD-3-Clause), not a new handwritten elliptic-curve implementation. Source dependencies and licenses are vendored after checksum verification; only the linked executable and license notices belong in portable artifacts. Runtime requires no Go, OpenSSL executable, npm, plugin installer or Internet connection.

SM2 supports public-key encryption/decryption (ASN.1 DER, uncompressed C1C3C2 and C1C2C3), signatures/verification with explicit UID, PEM/PKCS8/SPKI DER/raw Hex keys and key generation. Empty SM2 plaintext is explicitly rejected. SM4 supports CBC/CTR/GCM; CBC and CTR do not authenticate ciphertext. SHA-3 and SM3 support digests/HMAC. Inputs, encodings and operations are bounded and allowlisted; failures never return partial plaintext.

Run `go test -mod=vendor ./...` with OpenSSL installed in the connected test zone for independent SM2 encrypt/decrypt/sign/verify interoperability. End users do not need OpenSSL. Tests cover published known answers, binary/Unicode input, malformed input, wrong UID, modified ciphertext, GCM authentication and both native target builds. This is not a certification statement.
