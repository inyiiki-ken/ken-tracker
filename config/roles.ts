// ============================================================
// ROLE CONFIGURATION — Fully dynamic via Roles sheet
// All role assignments come from the connected Google Sheet.
// No staff emails are hardcoded in source code.
// ============================================================

  export type UserRole = 'super_admin' | 'admin' | 'dispatch' | 'accounts' | 'bossing' | 'liver' | 'purchasing' | 'livesellers';

  // No hardcoded super-admins -- add yourself as a row in the Roles sheet
  // (email column + role column = "super_admin") instead. See the warning
  // in the chat message that came with this change: if the Roles sheet has
  // no matching row for your email, you WILL be locked out on next sign-in.
  const _SA_LIST = "";
  const _SA_SET = new Set(_SA_LIST.toLowerCase().split('|').filter(Boolean));

  export const SUPER_ADMIN_EMAILS: string[] = _SA_LIST.split("|").filter(Boolean);

  // Email → Liver display name mapping (cleared for new owner — add new livers here)
  export const EMAIL_TO_LIVER_NAME: Record<string, string> = {};

  // Fallback roles - cached as Sets for performance (cleared for new owner)
  export const fallbackRoleConfig = {
    adminEmails: new Set<string>(),
    dispatchEmails: new Set<string>(),
    accountsEmails: new Set<string>(),
    bossingEmails: new Set<string>(),
    liverEmails: new Set<string>(),
    purchasingEmails: new Set<string>(),
  };

  // Type for dynamic roles (adjust if your DB uses a different structure)
  export type DynamicRole = {
    email?: string;
    Email?: string;
    EMAIL?: string;
    'Email Address'?: string;
    role?: string;
    Role?: string;
    ROLE?: string;
  };

  /**
   * Checks if email is in EMAIL_TO_LIVER_NAME and returns liver role
   */
  function getLiverRole(email: string): boolean {
    return Object.keys(EMAIL_TO_LIVER_NAME).some(
      key => key.toLowerCase() === email.toLowerCase()
    );
  }

  /**
   * Extracts email from dynamicRole object (handles multiple possible properties)
   */
  function getEmailFromRole(role: DynamicRole): string {
    return (role.email || role.Email || role.EMAIL || role['Email Address'] || '').toLowerCase().trim();
  }

  /**
   * Gets roles from a dynamic role object
   */
  function getRolesFromDynamic(role: DynamicRole): UserRole[] {
    const roleStr = (role.role || role.Role || role.ROLE || '').toLowerCase().trim();

    if (!roleStr) return [];

    // Check for exact role values
    const roles: UserRole[] = [];
    const parts = roleStr.split(',').map(s => s.trim().toLowerCase());

    for (const p of parts) {
      if (p === 'super_admin' || p === 'super admin' || p === 'superadmin') roles.push('super_admin');
      else if (p === 'admin') roles.push('admin');
      else if (p === 'dispatch') roles.push('dispatch');
      else if (p === 'accounts') roles.push('accounts');
      else if (p === 'bossing' || p === 'boss') roles.push('bossing');
      else if (p === 'liver') roles.push('liver');
      else if (p === 'purchasing') roles.push('purchasing');
      else if (p === 'livesellers' || p === 'live sellers' || p === 'stock') roles.push('livesellers');
    }

    return roles;
  }

  /**
   * Checks if email is in a fallback Set
   */
  function hasFallbackRole(email: string, set: Set<string>): boolean {
    return set.has(email.toLowerCase());
  }

  export function getUserRole(
    email: string,
    dynamicRoles: DynamicRole[] | null = null,
  ): UserRole[] {
    const e = email.toLowerCase().trim();
    const assignedRoles: UserRole[] = [];

    // 1. Super-admin check (fastest: Set.has is O(1))
    if (_SA_SET.has(e)) {
      return ['super_admin'];
    }

    // 2. Dynamic roles
    if (dynamicRoles && dynamicRoles.length > 0) {
      const found = dynamicRoles.find(r => getEmailFromRole(r) === e);

      if (found) {
        const roles = getRolesFromDynamic(found);
        if (roles.includes('super_admin')) assignedRoles.push('super_admin');
        if (roles.includes('admin') || roles.includes('super_admin')) assignedRoles.push('admin');
        if (roles.includes('dispatch')) assignedRoles.push('dispatch');
        if (roles.includes('accounts')) assignedRoles.push('accounts');
        if (roles.includes('bossing')) assignedRoles.push('bossing');
        if (roles.includes('liver')) assignedRoles.push('liver');
        if (roles.includes('purchasing')) assignedRoles.push('purchasing');
        if (roles.includes('livesellers')) assignedRoles.push('livesellers');
      }
    }

    // 3. Fallback roles
    if (hasFallbackRole(e, fallbackRoleConfig.adminEmails)) {
      assignedRoles.push('admin');
    }
    if (hasFallbackRole(e, fallbackRoleConfig.dispatchEmails)) {
      assignedRoles.push('dispatch');
    }
    if (hasFallbackRole(e, fallbackRoleConfig.accountsEmails)) {
      assignedRoles.push('accounts');
    }
    if (hasFallbackRole(e, fallbackRoleConfig.bossingEmails)) {
      assignedRoles.push('bossing');
    }
    if (hasFallbackRole(e, fallbackRoleConfig.liverEmails)) {
      assignedRoles.push('liver');
    }
    if (hasFallbackRole(e, fallbackRoleConfig.purchasingEmails)) {
      assignedRoles.push('purchasing');
    }

    // 4. EMAIL_TO_LIVER_NAME (guarantees liver role)
    if (getLiverRole(e) && !assignedRoles.includes('liver')) {
      assignedRoles.push('liver');
    }

    // Dedupe in case multiple sources granted same role
    return [...new Set(assignedRoles)];
  }
