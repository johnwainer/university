const interactiveEvents = [
    {
        id: 'ie-quiz-1',
        type: 'quiz',
        startsAtSec: 120,
        endsAtSec: 180,
        prompt: 'What is the key topic covered in this block?',
        options: ['Product strategy', 'Linear algebra', 'Cooking basics']
    },
    {
        id: 'ie-cta-1',
        type: 'cta',
        startsAtSec: 420,
        endsAtSec: 520,
        prompt: 'Download the learning guide for this lesson.',
        ctaUrl: 'https://example.com/guide'
    }
];
export const demoTenant = {
    id: 'tenant-pae-u',
    slug: 'pae-u',
    name: 'PAE-U',
    locales: ['es', 'en'],
    currency: 'USD',
    branding: {
        logoUrl: 'https://dummyimage.com/180x48/0f172a/ffffff&text=PAE-U',
        primaryColor: '#bf360c',
        accentColor: '#f59e0b',
        heroGradient: 'linear-gradient(135deg, #101820 0%, #bf360c 48%, #f59e0b 100%)'
    }
};
export const demoUser = {
    id: 'user-1',
    fullName: 'Alex Johnson',
    email: 'alex@example.com',
    locale: 'en',
    roles: ['tenant_admin', 'learner'],
    tenantId: demoTenant.id
};
export const demoCatalog = [
    {
        id: 'vod-1',
        slug: 'ott-growth-masterclass',
        title: 'OTT Growth Masterclass',
        summary: 'VoD premium series about monetization, catalog design and audience retention.',
        kind: 'vod',
        accessModel: 'subscription',
        durationMinutes: 92,
        language: 'en',
        tags: ['OTT', 'Growth', 'Premium'],
        heroImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=80',
        playback: {
            hlsUrl: 'https://example.com/hls/ott-growth-masterclass.m3u8',
            drm: true,
            subtitles: ['en', 'es'],
            interactiveEvents
        }
    },
    {
        id: 'live-1',
        slug: 'global-edtech-summit',
        title: 'Global EdTech Summit Live',
        summary: 'Live event with surveys, contests and CTA overlays for audience conversion.',
        kind: 'live',
        accessModel: 'purchase',
        durationMinutes: 180,
        language: 'es',
        tags: ['Live', 'EdTech', 'Interactive'],
        heroImage: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1400&q=80',
        playback: {
            hlsUrl: 'https://example.com/hls/global-edtech-summit-live.m3u8',
            drm: true,
            subtitles: ['es', 'en'],
            interactiveEvents
        },
        startsAt: '2026-04-10T18:00:00Z',
        endsAt: '2026-04-10T21:00:00Z',
        concurrentViewersTarget: 50000
    },
    {
        id: 'course-1',
        slug: 'saas-operator-program',
        title: 'SaaS Operator Certification',
        summary: 'Structured Moodle course with lessons, assessments and certificate tracking.',
        kind: 'course',
        accessModel: 'purchase',
        durationMinutes: 600,
        language: 'en',
        tags: ['Course', 'Moodle', 'Certification'],
        heroImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80',
        moodleCourseId: 'mdl-2048',
        modules: 8,
        lessons: 36,
        progress: {
            completionRate: 42,
            status: 'in_progress',
            certificateEligible: false
        }
    }
];
export const demoOffers = [
    {
        id: 'offer-sub-monthly',
        name: 'Global Access Monthly',
        description: 'Access all premium VoD, live events and starter learning catalog.',
        price: 19,
        currency: 'USD',
        billingPeriod: 'monthly',
        type: 'subscription'
    },
    {
        id: 'offer-course-pack',
        name: 'Certification Pack',
        description: 'One-time purchase bundle for professional courses and certificates.',
        price: 149,
        currency: 'USD',
        type: 'bundle'
    }
];
export const demoEntitlements = demoCatalog.map((content) => ({
    contentId: content.id,
    granted: content.kind === 'vod',
    reason: content.kind === 'vod' ? 'subscription' : 'missing_access'
}));
export const demoHomeResponse = {
    tenant: demoTenant,
    user: demoUser,
    featured: demoCatalog,
    liveNow: demoCatalog.filter((item) => item.kind === 'live'),
    continueLearning: demoCatalog.filter((item) => item.kind === 'course'),
    offers: demoOffers
};
export const demoBlueprint = {
    domains: [
        'identity and access',
        'tenant configuration',
        'catalog and editorial',
        'commerce and billing',
        'learning and progress',
        'playback and interactive events',
        'notifications and analytics'
    ],
    publicApis: [
        'GET /v1/home',
        'GET /v1/catalog',
        'GET /v1/catalog/:slug',
        'GET /v1/offers',
        'GET /v1/entitlements',
        'GET /v1/blueprint'
    ],
    integrations: [
        'Moodle core + plugins',
        'Stripe',
        'AWS Media Services or Bitmovin/Mux',
        'GA4 and playback QoE provider',
        'Email/push provider',
        'External IdP'
    ],
    targetPlatforms: {
        web: ['React', 'Vite', 'shared SDK', 'i18n es/en'],
        mobile: ['React Native planned', 'shared API SDK', 'push notifications'],
        tv: ['Android TV planned', 'tvOS planned', 'HLS playback contracts']
    },
    capabilities: [
        {
            id: 'cap-1',
            name: 'Multi-tenant branding and content rules',
            status: 'mvp',
            description: 'Tenant-aware theming, localized catalog and entitlement checks.'
        },
        {
            id: 'cap-2',
            name: 'VoD/live playback with overlays',
            status: 'mvp',
            description: 'HLS playback, subtitles and timed interactive events.'
        },
        {
            id: 'cap-3',
            name: 'Mobile and TV clients',
            status: 'phase_2',
            description: 'Reuse API contracts and shared logic across new clients.'
        }
    ]
};
