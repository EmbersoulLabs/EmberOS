# EmberOS Development Rules

Version: 1.0

Status: Active

---

# Purpose

This document defines the engineering workflow for EmberOS.

It does not define product behavior.

Product behavior is defined only by the Blueprint Repository.

---

# Repository Authority

Single Source of Truth

Blueprint Repository

Authority Order

Blueprint

↓

Decision

↓

Specification

↓

UI Specification

↓

Implementation Roadmap

↓

Source Code

Implementation must never redefine product decisions.

If implementation conflicts with the Blueprint:

STOP

Report the conflict.

Do not silently redesign the product.

---

# AI Responsibilities

## ChatGPT

Responsibilities

- Sprint Planning
- Architecture Review
- Task Breakdown
- Specification Review
- Code Review
- Acceptance Review

Must Not

- Modify Blueprint decisions without user approval.

---

## Cursor

Responsibilities

- Feature implementation
- Refactoring
- Bug fixing
- Test implementation

Must Not

- Invent product behavior.
- Expand feature scope.

---

## Codex

Responsibilities

- Repository analysis
- Gap analysis
- Code review
- Security review
- Testing review
- Engineering validation

Must Not

- Redesign product decisions.
- Automatically modify unrelated files.
- Mix multiple Sprint objectives.

---

# Sprint Workflow

Every Sprint follows this order.

Sprint Planning

↓

Gap Analysis

↓

Task Breakdown

↓

Implementation

↓

Code Review

↓

Manual Testing

↓

Git Commit

↓

Git Push

No step may be skipped.

---

# Git Rules

Never use

git add .

git add -A

git commit -a

unless explicitly instructed.

Always stage only intended files.

One Sprint

One Commit Topic

One Review

---

# Branch and Deployment Workflow

Branch authority:

- `main` is Production.
- `staging` is Integration, QA, and Mobile Testing.
- `feature/*` branches are temporary feature branches.

Development flow:

```text
feature/*

↓

staging

↓

QA / Mobile Testing

↓

main

↓

Production
```

Feature branches must be merged into `staging` before they are considered for `main`.

`staging` is the required validation branch for:

- Web testing
- Android Chrome testing
- Android App testing when available
- iOS Safari testing
- iOS App testing when available

After `staging` is approved, merge `staging` into `main`.

Production deployment must only come from `main`.

Do not merge feature branches directly into `main` unless explicitly approved as an emergency exception.

Do not delete feature branches automatically.

Vercel deployment policy:

- `main` maps to Production deployment.
- `staging` maps to long-term Staging Preview deployment.
- `feature/*` branches may create temporary Preview deployments.

If Vercel does not automatically deploy `staging`, configure the Vercel project to include `staging` as a deployable branch.

Manual testing must be completed on the Staging deployment before approving `staging -> main`.

---

# Working Tree Safety

Do not modify unrelated files.

Do not clean the working tree automatically.

Do not restore files automatically.

If unrelated staged files exist:

STOP

Report them.

---

# Security Rules

Backend authorization is mandatory.

Frontend authorization is not sufficient.

Workspace isolation is mandatory.

Business data must remain Workspace-scoped.

Sensitive operations must produce Audit Logs.

---

# Prompt Governance

Prompt changes must follow:

Analysis

↓

Draft

↓

Diff Review

↓

Sandbox Test

↓

Comparison

↓

Human Approval

↓

Publish

↓

Monitoring

↓

Rollback (if required)

AI may recommend Prompt changes.

AI may generate Prompt drafts.

AI must never publish Prompts directly.

---

# Definition of Done

A Sprint is complete only when:

Implementation complete

Tests pass

Review completed

Manual testing passed

No security regression

No Blueprint conflict

Git commit completed

---

# Code Review Checklist

Review:

Specification compliance

UI Specification compliance

Permission enforcement

Workspace isolation

RLS consistency

Validation

Audit logging

API consistency

Regression

Security

---

# Repository Rules

Do not rename repository structure without approval.

Do not move specifications.

Do not duplicate authoritative documents.

Append history whenever appropriate.

---

# Engineering Principle

Small, reviewable changes are preferred over large changes.

Stability is preferred over speed.

Product decisions belong to the Blueprint.

Engineering decisions belong to the implementation repository.
