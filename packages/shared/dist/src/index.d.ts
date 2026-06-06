export type Locale = 'es' | 'en';
export type ContentKind = 'vod' | 'live' | 'course' | 'bundle';
export type AccessModel = 'free' | 'subscription' | 'purchase' | 'code';
export interface TenantBranding {
    logoUrl: string;
    primaryColor: string;
    accentColor: string;
    heroGradient: string;
}
export interface Tenant {
    id: string;
    slug: string;
    name: string;
    locales: Locale[];
    currency: string;
    branding: TenantBranding;
}
export interface UserProfile {
    id: string;
    fullName: string;
    email: string;
    locale: Locale;
    roles: string[];
    tenantId: string;
}
export interface InteractiveEvent {
    id: string;
    type: 'quiz' | 'poll' | 'cta' | 'info';
    startsAtSec: number;
    endsAtSec: number;
    prompt: string;
    options?: string[];
    ctaUrl?: string;
}
export interface ContentAsset {
    id: string;
    slug: string;
    title: string;
    summary: string;
    titleEn?: string;
    summaryEn?: string;
    kind: ContentKind;
    accessModel: AccessModel;
    durationMinutes?: number;
    language: Locale;
    tags: string[];
    heroImage: string;
    playback?: {
        hlsUrl: string;
        drm: boolean;
        subtitles: string[];
        interactiveEvents: InteractiveEvent[];
    };
}
export interface CourseProgress {
    completionRate: number;
    status: 'not_started' | 'in_progress' | 'completed';
    certificateEligible: boolean;
}
export interface Course extends ContentAsset {
    kind: 'course';
    moodleCourseId: string;
    modules: number;
    lessons: number;
    progress: CourseProgress;
}
export interface LiveEvent extends ContentAsset {
    kind: 'live';
    startsAt: string;
    endsAt: string;
    concurrentViewersTarget: number;
}
export interface Offer {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    billingPeriod?: 'monthly' | 'yearly';
    type: 'subscription' | 'purchase' | 'bundle';
}
export interface Entitlement {
    contentId: string;
    granted: boolean;
    reason: 'free' | 'subscription' | 'purchase' | 'code' | 'missing_access';
}
export interface HomeResponse {
    tenant: Tenant;
    user: UserProfile;
    featured: ContentAsset[];
    liveNow: LiveEvent[];
    continueLearning: Course[];
    offers: Offer[];
}
export interface PlatformCapability {
    id: string;
    name: string;
    status: 'mvp' | 'phase_2' | 'phase_3';
    description: string;
}
export interface PlatformBlueprintResponse {
    domains: string[];
    publicApis: string[];
    integrations: string[];
    targetPlatforms: {
        web: string[];
        mobile: string[];
        tv: string[];
    };
    capabilities: PlatformCapability[];
}
export declare const demoTenant: Tenant;
export declare const demoUser: UserProfile;
export declare const demoCatalog: ContentAsset[];
export declare const demoOffers: Offer[];
export declare const demoEntitlements: Entitlement[];
export declare const demoHomeResponse: HomeResponse;
export declare const demoBlueprint: PlatformBlueprintResponse;
