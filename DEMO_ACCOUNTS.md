# Demo Accounts

Seeded via `prisma/seed.ts`. Every account shares the same password:

**Password:** `password123`

Never use these credentials or this password pattern in a production environment - they exist purely for local development and demos.

## Buyer side — Acme Technologies

| Name | Email | Role | Company |
|---|---|---|---|
| John Doe | `john.doe@acmetech.example` | Procurement Manager | Acme Technologies Ghana |
| John Doe | `john.doe@acmetech.example` | Owner | Acme Technologies Nigeria |
| John Doe | `john.doe@acmetech.example` | Owner | Acme Technologies Kenya |
| Sarah Smith | `sarah.smith@acmetech.example` | Finance Manager | Acme Technologies Ghana |
| Michael Doe | `michael.doe@acmetech.example` | Employee | Acme Technologies Ghana |

John Doe belongs to all three Acme companies — after logging in, use the company switcher (top nav) to move between them.

## Supplier side

| Name | Email | Role | Supplier | Verification |
|---|---|---|---|---|
| Adwoa Mensah | `adwoa.mensah@abctech.example` | Supplier Admin | ABC Technology Solutions (`supplier-abc`) | Verified |
| Kofi Boateng | `kofi.boateng@primeoffice.example` | Supplier Admin | Prime Office Supplies (`supplier-prime`) | Verified |
| Yaw Darko | `yaw.darko@accraindustrial.example` | Supplier Admin | Accra Industrial Equipment (`supplier-aie`) | Premium Verified |
| Chidi Okafor | `chidi.okafor@waelectronics.example` | Supplier Admin | West Africa Electronics (`supplier-wae`) | Verified |
| Efua Asante | `efua.asante@kumasiprint.example` | Supplier Admin | Kumasi Print & Pack (`supplier-kpp`) | Pending Verification |

## Platform

| Name | Email | Role |
|---|---|---|
| Grace Owusu | `grace.owusu@platform.example` | Platform Admin |

## Notes

- Re-running `npm run db:seed` restores/updates all of the above without touching anything else you've created locally.
- To reset a forgotten local Postgres password, see the steps recorded in this session's history (temporarily switch `pg_hba.conf` to `trust`, `ALTER USER`, then switch back to `scram-sha-256`).
