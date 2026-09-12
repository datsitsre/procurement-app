# xwiggy-app

The SpringFood frontend - Angular 19. See the [root README](../README.md) for how this fits
with the backend and how to run the whole stack (locally or via Docker).

## Development server

`npx ng serve` - runs on `http://localhost:4200/` with live reload. Requires the backend
running on `:8080` (see `../xwiggy-back`).

## Build

`npx ng build` - output goes to `dist/xwiggy-app/`. Uses the `production` configuration by
default (see `angular.json`); pass `--configuration development` for a dev build.

## Tests

`npx ng test` runs the Karma/Jasmine unit tests. The generated spec files are still
placeholders - there's no real coverage yet.
