# SpringFood (xwiggy)

An online food ordering app: customers browse a menu, order, and pay; merchants manage stock
and add new items. Full-stack: Angular 19 frontend, Spring Boot 3 / Java 17 backend, MySQL.

```
xwiggy-app/   Angular 19 frontend
xwiggy-back/  Spring Boot 3 backend (REST API + JWT auth)
docker/       MySQL init script used by docker-compose
```

## Architecture

- **Auth**: JWT, issued by `POST /login` and `POST /register`, sent as `Authorization: Bearer <token>`.
  Passwords are BCrypt-hashed; roles are `USER` and `MERCHANT` (merchant-only endpoints are
  role-gated in `SecurityConfig`).
- **Orders**: `POST /order` creates a PENDING order (stock untouched) from a list of
  `{foodId, quantity}` lines; `POST /order/{id}/pay` re-validates stock, deducts it, and marks
  the order PAID. `GET /orders` returns the caller's order history.
- **API docs**: Swagger UI at `/swagger-ui.html` (OpenAPI JSON at `/v3/api-docs`) once the
  backend is running.
- **Health**: `/actuator/health`.

## Run locally (no Docker)

Requires MySQL running locally, Java 17, and Node 22.

1. Load the schema: `mysql -u root myusers < docker/mysql-init/init.sql` (create the
   `myusers` database first if it doesn't exist).
2. Backend: `cd xwiggy-back && ./mvnw spring-boot:run` - runs on `:8080` with the `dev` profile
   (see `application-dev.properties`; defaults to `root` with no password against
   `localhost:3306/myusers`).
3. Frontend: `cd xwiggy-app && npm install && npx ng serve` - runs on `:4200`.
4. Log in with the seeded demo accounts: `user`/`user` or `merchant`/`merchant`.

## Run with Docker

```
cp .env.example .env   # fill in real values - see comments in the file
docker compose up --build
```

This starts MySQL (seeded from `docker/mysql-init/init.sql`), the backend on `:8080`, and the
frontend on `:4200`. The frontend's nginx reverse-proxies API calls to the backend container
(see `xwiggy-app/nginx.conf`), so the browser only ever talks to one origin.

## Configuration

Backend config is split by Spring profile:

- `application.properties` - shared defaults.
- `application-dev.properties` - local dev values, safe to keep in source (no real secrets).
- `application-prod.properties` - everything comes from environment variables with **no**
  fallback defaults for secrets, so a misconfigured prod deploy fails to start rather than
  silently running with a dev secret. See `.env.example` for the full list
  (`DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`).

Frontend API base URL is in `src/environments/environment.ts` (dev) and
`environment.prod.ts` (prod - empty string, since prod calls go through the same-origin nginx
proxy rather than a hardcoded backend hostname).

## Tests

- Backend: `cd xwiggy-back && ./mvnw test` (JUnit 5; `ApiTests` uses `@WebMvcTest` slices with
  the real `SecurityConfig` imported so it exercises actual auth rules, `XwiggyApplicationTests`
  boots the full context against a real database).
- Frontend: unit test scaffolding exists (`ng test`) but the generated spec files are still
  placeholders - there's no real coverage to run yet.

## CI

`.github/workflows/ci.yml` builds and tests the backend against a MySQL service container,
builds the frontend, and builds both Docker images, on every push/PR.
