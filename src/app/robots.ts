import type { MetadataRoute } from 'next';

const SITE_URL = 'https://procurement-platform.example';

/**
 * Everything past the marketing landing page, login, and registration requires an
 * authenticated session (see (app)/layout.tsx's redirect-to-login guard) - there's nothing for
 * a crawler to usefully index behind that wall, and every one of those routes shows
 * company-scoped data that has no business appearing in a search result. Only the three public
 * routes are left crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/login', '/register'],
      disallow: ['/dashboard', '/admin', '/orders', '/cart', '/catalog', '/rfqs', '/purchase-requests', '/purchase-orders', '/invoices', '/payments', '/products', '/suppliers', '/team', '/settings', '/notifications', '/analytics', '/approvals', '/compare', '/more', '/product'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
