/**
 * English catalog, the reference shape every other catalog must match.
 * Covers the Phase 1 production screens only; the legacy demo is not localized yet.
 */
export const en = {
  common: {
    appName: "ORQO",
    tagline: "You meet the person. ORQO finds the business.",
    openDemo: "Open the demo",
    signIn: "Sign in",
    signUp: "Create account",
    signOut: "Sign out",
    email: "Email",
    password: "Password",
    save: "Save",
    saved: "Saved",
    language: "Language",
    genericError: "Something went wrong. Please try again.",
  },
  errors: {
    forbidden: "Your role does not allow this action.",
    notFound: "Not found, or you do not have access.",
    conflict: "This already exists.",
    invalidInput: "Some fields are invalid.",
    rateLimited: "Limit reached. Try again later.",
  },
  locales: {
    en: "English",
    fr: "Français",
  },
  roles: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    viewer: "Viewer",
  },
  home: {
    title: "Turn relationships into opportunities.",
    body: "ORQO is becoming a business development workspace for your whole team. Sign in to your workspace, or explore the interactive demo.",
    demoHint: "The demo runs entirely in your browser with fictional companies. No account needed.",
  },
  auth: {
    signInTitle: "Sign in to ORQO",
    signUpTitle: "Create your ORQO account",
    displayName: "Your name",
    passwordHint: "At least {min} characters.",
    noAccount: "No account yet?",
    haveAccount: "Already have an account?",
    invalidCredentials: "Email or password is incorrect.",
    emailNotConfirmed: "Confirm your email address before signing in. Check your inbox.",
    invalidInput: "Check the highlighted fields.",
    rateLimited: "Too many attempts. Wait a moment and try again.",
    checkEmailTitle: "Check your email",
    checkEmailBody: "We sent a confirmation link to {email}. Open it to activate your account, then sign in.",
    confirmFailed: "This confirmation link is invalid or has expired.",
  },
  onboarding: {
    title: "Create your workspace",
    body: "A workspace holds your organization's companies, relationships and opportunities. Only its members can see it.",
    nameLabel: "Workspace name",
    namePlaceholder: "Acme Robotics",
    submit: "Create workspace",
  },
  workspace: {
    yourRole: "Your role: {role}",
    members: "Members",
    companies: "Companies",
    companiesEmpty: "No companies yet. Add the first one below.",
    addCompany: "Add company",
    companyName: "Company name",
    website: "Website (optional)",
    account: "Account",
    languageSaved: "Language updated.",
    viewerReadOnly: "Viewers can read this workspace but not change it.",
    count: "{count} total",
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape every catalog implements: same keys as English, any strings. */
export type Messages = Widen<typeof en>;
