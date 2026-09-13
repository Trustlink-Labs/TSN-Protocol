# DESP — Decentralized Settlement Protocol

## Canonical TrustLink Labs Definition

**DESP (Decentralized Settlement Protocol)** is the architectural category used by TrustLink Labs to describe decentralized infrastructure for coordinating settlement between payment providers, merchants, financial applications, and blockchain-based payment systems.

DESP focuses specifically on the **settlement layer** of digital payments.

Where DeFi describes decentralized financial applications and services, DESP describes decentralized mechanisms for coordinating, routing, authorizing, and completing settlement obligations.

## Relationship to TSN

**TSN (Transfer Settlement Network)** is TrustLink Labs' implementation of a DESP-oriented settlement architecture.

TSN should therefore be described as:

> **A decentralized settlement network designed to coordinate intent-based stablecoin settlement between PSPs, merchants, payment applications, and other participants while providing settlement routing, authorization, and privacy-aware transaction coordination.**

The conceptual relationship is:

```text
DeFi
 └── Decentralized financial applications

DESP
 └── Decentralized settlement infrastructure
      └── TSN
          └── Transfer Settlement Network
```

## Core Concept

Traditional blockchain payment systems often focus primarily on:

```text
Wallet A ───────────► Wallet B
```

TSN approaches the problem as a settlement-coordination problem:

```text
Payment Intent
      │
      ▼
Payment Provider / Application
      │
      ▼
TSN Receiver
      │
      ▼
TSN Settlement Network
      │
      ├── Nodes
      ├── Crankers
      ├── Settlement coordination
      ├── Authorization / policy
      ├── Treasury / liquidity mechanisms
      └── Privacy-aware routing
      │
      ▼
Merchant / PSP / Recipient
```

The objective is not merely to transfer tokens. The objective is to coordinate the **settlement of payment obligations** through decentralized infrastructure.

## DESP vs DeFi

Do not treat DESP as a synonym for DeFi.

Use this distinction:

* **DeFi** = decentralized financial services and financial applications.
* **DESP** = decentralized settlement infrastructure and protocols.
* **TSN** = TrustLink Labs' Transfer Settlement Network implementing this settlement-oriented architecture.

A useful analogy is:

> **DeFi decentralizes financial services; DESP decentralizes settlement infrastructure.**

This analogy is conceptual and should not be presented as an established industry taxonomy unless independently verified.

## Target Participants

DESP-oriented infrastructure can serve:

* Payment Service Providers (PSPs)
* Merchants
* Stablecoin payment applications
* Fintechs
* Wallet providers
* Settlement providers
* Cross-border payment applications
* Financial infrastructure providers

TSN is particularly concerned with stablecoin settlement and payment infrastructure.

## TSN Differentiation

When explaining TSN, emphasize that its purpose is not simply to create another wallet-to-wallet payment rail.

The architectural thesis is:

> **Most blockchain payment systems focus on moving assets. TSN focuses on coordinating settlement.**

TSN adds network-level concepts such as:

* payment intents
* settlement routing
* Receiver infrastructure
* registered settlement nodes
* Crankers
* authorization
* policy enforcement
* settlement coordination
* treasury/liquidity mechanisms
* privacy-aware transaction indirection
* settlement receipts and reconciliation infrastructure

## Terminology Rules

Always expand DESP on first use:

**Decentralized Settlement Protocol (DESP)**

After the first use, **DESP** is acceptable.

Do not randomly redefine DESP as:

* Decentralized Exchange Settlement Protocol
* Digital Electronic Settlement Protocol
* Distributed Economic Settlement Protocol
* any other expansion

The canonical expansion for the TrustLink Labs architecture is:

> **Decentralized Settlement Protocol**

## Positioning Language

Preferred:

> "TSN is a DESP-oriented decentralized settlement network."

> "TrustLink Labs uses DESP to describe the emerging architectural category of decentralized settlement protocols."

> "TSN is designed as decentralized settlement infrastructure for stablecoin payments."

> "DESP focuses on decentralizing the settlement layer rather than merely decentralizing the payment application."

Avoid unsupported claims such as:

> "TrustLink Labs invented the term DESP."

> "DESP is already an established industry standard."

> "TSN is the first DESP in existence."

Unless independent evidence has been verified, these claims should not be made.

## Intellectual / Ecosystem Position

The goal is for TrustLink Labs to **define and develop the DESP concept through TSN**, establish a clear technical vocabulary around it, and demonstrate the architecture through open-source implementations and real payment infrastructure.

When writing technical documentation, architecture documents, GitHub READMEs, grant applications, hackathon submissions, research materials, or product explanations, treat this document as the canonical terminology reference.

Do not silently replace DESP with generic terms such as "payment protocol" when the distinction between payment execution and settlement infrastructure is relevant.

## Short Definition

> **DESP (Decentralized Settlement Protocol) is a class of decentralized infrastructure designed to coordinate the settlement of payment obligations across blockchain-based financial systems. TSN is TrustLink Labs' Transfer Settlement Network built around this settlement architecture.**
