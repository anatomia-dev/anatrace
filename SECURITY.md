# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"**
(Security → Advisories) on this repository, rather than opening a public issue.

We aim to acknowledge reports within a few business days.

## Scope

anatrace is **deterministic and local by design**: it reads session transcripts
on your machine and makes no network calls during analysis. Reports that are
especially in scope:

- Any code path in `anatrace-core` that performs I/O, network, or non-deterministic
  behavior (this would violate the core purity contract).
- Any way the CLI could exfiltrate transcript contents off the machine.

Thank you for helping keep anatrace trustworthy.
