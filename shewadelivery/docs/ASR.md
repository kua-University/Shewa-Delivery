 
# Section 2: Architecturally Significant Requirements (ASR) Document

## Document Information
- **Version**: 1.0
- **Date**: 2024
- **Project**: ShewaDelivery
- **Status**: Approved

## 2.1 Introduction

### 2.1.1 Purpose

This ASR document serves as the architectural "north star" for ShewaDelivery. Every significant technical decision made throughout the design — the choice of microservices, the use of a message queue, the decision to cache menu data — traces back to one or more of the requirements described here. If a proposed design decision does not serve any ASR, it should be questioned.

### 2.1.2 System Overview

ShewaDelivery is a real-time, multi-actor food delivery platform. It must simultaneously serve hundreds of concurrent customers browsing menus, dozens of restaurants processing orders, and active delivery drivers updating their GPS position every few seconds — all while maintaining a smooth, fast user experience on mobile devices, many of which operate on 3G or limited 4G networks in Ethiopian cities.

## 2.2 Business Drivers

| Business Driver | Explanation | Architectural Impact |
|----------------|-------------|---------------------|
| **Zero Order Loss** | A lost order means a hungry customer and an unpaid restaurant. Every order must be recorded and confirmed, even during server hiccups. | Reliable message queues, database transactions, and retry mechanisms |
| **Mobile-First Reliability** | Most Ethiopian users access services via mobile phones on variable internet connections. The app must feel fast and must not crash on slow networks. | API response caching, payload optimization, offline-tolerant design |
| **Rapid Feature Growth** | As ShewaDelivery expands to new cities and adds features, the architecture must absorb change without full rewrites. | Microservices, decoupled services, clean API contracts |

## 2.3 Quality Attribute Priorities

| Priority | Quality Attribute | Why It Matters for ShewaDelivery |
|----------|------------------|----------------------------------|
| **1 — Critical** | Availability | Delivery platforms run 24/7. Downtime = lost revenue and customer trust. |
| **2 — Critical** | Performance | Users abandon slow apps. Menu loading and order placement must be near-instant. |
| **3 — High** | Scalability | Lunch rush (12–2pm) generates 10x normal traffic. Must handle spikes automatically. |
| **4 — High** | Security | Payment data, user addresses, and location history are sensitive personal data. |
| **5 — Medium** | Maintainability | A growing startup adds features fast. Code must stay readable and modular. |
| **6 — Medium** | Usability | Non-technical users (restaurant owners, drivers) must onboard without IT support. |

## 2.4 Quality Attribute Scenarios

The following scenarios use the Stimulus-Response format used in the Architecture Tradeoff Analysis Method (ATAM). Each scenario describes a realistic situation the system must handle, and what the correct architectural response should be.

| ID | Attribute | Priority | Scenario (Stimulus → Response) |
|----|-----------|----------|-------------------------------|
| **ASR-01** | Availability | Critical | **STIMULUS**: Primary database node crashes during peak lunch hour. **RESPONSE**: System automatically fails over to hot standby replica within 30 seconds. No orders are lost. |
| **ASR-02** | Performance | Critical | **STIMULUS**: 500 customers simultaneously request the restaurant list. **RESPONSE**: API Gateway returns cached restaurant list from Redis within 200ms. Database is not touched. |
| **ASR-03** | Performance | Critical | **STIMULUS**: Customer on 3G places an order. **RESPONSE**: Order confirmation appears within 2 seconds. Payment and notifications processed asynchronously in background. |
| **ASR-04** | Scalability | High | **STIMULUS**: Promotional campaign causes 10x traffic spike. **RESPONSE**: Kubernetes HPA spins up 5 additional Order Service pods within 90 seconds. Response times remain under 2s. |
| **ASR-05** | Security | High | **STIMULUS**: Malicious user tries to access another user's order history. **RESPONSE**: JWT middleware rejects with HTTP 403 and logs the attempt. |
| **ASR-06** | Security | High | **STIMULUS**: Payment transaction initiated. **RESPONSE**: Chapa called via HTTPS/TLS 1.3. No raw card data stored — only a transaction reference token. PCI-DSS compliant. |
| **ASR-07** | Availability | Critical | **STIMULUS**: Notification Service crashes with 50 orders in-flight. **RESPONSE**: Orders already confirmed via Order Service. RabbitMQ queues notifications; sent retroactively on restart. |
| **ASR-08** | Maintainability | Medium | **STIMULUS**: Team needs to add "scheduled order" feature. **RESPONSE**: Only Order Service modified. No other services changed or redeployed. |
| **ASR-09** | Usability | Medium | **STIMULUS**: Non-technical restaurant owner logs in for the first time. **RESPONSE**: Step-by-step wizard with Amharic/English labels. Menu setup completed in under 10 minutes. |
| **ASR-10** | Scalability | High | **STIMULUS**: Expansion to new city (Bahir Dar). **RESPONSE**: No architectural changes needed. City configuration managed through admin panel only. |

## 2.5 Architectural Constraints

| Constraint | Description |
|------------|-------------|
| **Network** | The system must perform acceptably on 3G connections (minimum 1 Mbps). API responses must be paginated and lightweight. Images must be served via CDN, not directly from the application server. |
| **Financial** | Infrastructure costs must scale with revenue. Kubernetes autoscaling and serverless components address this. |
| **Regulatory** | Ethiopian financial regulations require that payment transaction records be stored in a region accessible to Ethiopian authorities. AWS af-south-1 (Cape Town) is the closest compliant region. |
| **Language** | The system must support both Amharic and English. The database must store Unicode text correctly, and search must handle Amharic character sets. |

## 2.6 Technical Risks & Challenges

| Risk | Description | Mitigation Strategy |
|------|-------------|---------------------|
| **GPS Accuracy in Dense Urban Areas** | Delivery tracking can be inaccurate in dense city centers. | Use Google Maps Platform with address validation; allow drivers to confirm pickup/dropoff manually. |
| **Real-Time Data Volume** | 50 concurrent drivers generate 600–1000 GPS writes/minute. | Store GPS in MongoDB (optimized for high-frequency writes). Use Redis to serve latest position without hitting the DB. |
| **Chapa Integration Reliability** | If Chapa API is slow or down, order placement freezes for the customer. | Implement 10-second payment timeout. Order held in "pending payment" status — data is never lost. |
| **Session Consistency** | Multiple devices on same account could lead to race conditions on cart data. | Cart stored server-side. Redis-based session management ensures one active cart per user account. |

## 2.7 Trade-off Analysis

### Consistency vs. Speed (CAP Theorem)

ShewaDelivery prioritizes **Availability and Partition Tolerance** over strict Consistency (AP system in CAP terms). If a network partition occurs between the Order Service and the Payment Service, the Order Service will still accept the order and queue the payment event rather than refusing the order entirely. The slight risk of a delayed payment record is preferable to a customer seeing "Service Unavailable" at the moment of ordering.

### Microservices Complexity vs. Scalability

Microservices add development complexity: more services to deploy, monitor, and maintain. However, given that ShewaDelivery's Delivery and Notification services have dramatically different scaling needs than the Auth or Restaurant services, the microservices split is justified. The team accepts higher initial complexity in exchange for long-term scalability and fault isolation.

### Database Choices

| Database | Use Case | Rationale |
|----------|----------|-----------|
| **PostgreSQL** | Orders, users, payments | ACID compliance for financial transactions |
| **MongoDB** | GPS tracking | Optimized for high-frequency writes (600-1000/minute) |
| **Redis** | Caching menus, sessions, driver positions | Sub-millisecond latency for real-time data |

## 2.8 Conclusion

The ten ASR scenarios defined in this document represent the architectural DNA of ShewaDelivery. Every design decision — from choosing RabbitMQ for messaging to using Redis for caching to deploying on Kubernetes — is a direct response to one or more of these requirements. Any future design change that conflicts with a Critical or High priority ASR must be reviewed and approved by the lead architect before implementation.

## ASR Traceability Matrix

| Component | ASR-01 | ASR-02 | ASR-03 | ASR-04 | ASR-05 | ASR-06 | ASR-07 | ASR-08 | ASR-09 | ASR-10 |
|-----------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|
| API Gateway | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| Order Service | ✓ | | ✓ | | | | ✓ | ✓ | | |
| Payment Service | | | | | | ✓ | | | | |
| Notification Service | | | | | | | ✓ | | | |
| Delivery Service | | | ✓ | | | | | | | ✓ |
| Restaurant Service | | ✓ | | | | | | ✓ | | |
| Auth Service | | | | | ✓ | | | | | |
| Frontend | | ✓ | ✓ | | | | | | ✓ | |
| PostgreSQL | ✓ | | | | | | | | | |
| MongoDB | | | | | | | | | | ✓ |
| Redis | | ✓ | ✓ | | | | | | | |
| RabbitMQ | | | | | | | ✓ | | | |
| Kubernetes | | | | ✓ | | | | | | |

## Implementation Status

| ASR ID | Status | Implementation Details |
|--------|--------|----------------------|
| ASR-01 | ✅ Implemented | PostgreSQL replication, RabbitMQ dead letter queues, order persistence |
| ASR-02 | ✅ Implemented | Redis caching, API response compression, CDN for images |
| ASR-03 | ✅ Implemented | Async payment processing, offline queue, batch GPS updates |
| ASR-04 | ✅ Implemented | Kubernetes HPA, auto-scaling based on CPU/memory metrics |
| ASR-05 | ✅ Implemented | JWT authentication, RBAC, token blacklisting |
| ASR-06 | ✅ Implemented | Chapa integration, TLS 1.3, PCI-DSS compliant storage |
| ASR-07 | ✅ Implemented | RabbitMQ queues, dead letter exchange, retroactive notifications |
| ASR-08 | ✅ Implemented | Microservices architecture, clean APIs, feature flags |
| ASR-09 | ✅ Implemented | Onboarding wizard, Amharic/English i18n support |
| ASR-10 | ✅ Implemented | City configuration in database, dynamic delivery zones |

## References

- Carnegie Mellon SEI: [sei.cmu.edu](https://sei.cmu.edu)
- Bass et al. — *Software Architecture in Practice* (3rd ed.). Addison-Wesley, 2012.
- Chapa API: [developer.chapa.co](https://developer.chapa.co)
- Kubernetes HPA: [kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale)

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024 | Architecture Team | Initial ASR document |
| 1.1 | 2024 | Architecture Team | Added traceability matrix |
| 1.2 | 2024 | Architecture Team | Updated implementation status |