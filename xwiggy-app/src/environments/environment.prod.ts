// Production requests go to the same origin the app is served from - the frontend's nginx
// (see xwiggy-app/nginx.conf) reverse-proxies the known API paths through to the backend
// container, so there's no cross-origin call and no backend hostname baked into this bundle.
export const environment = {
  production: true,
  apiUrl: ''
};
