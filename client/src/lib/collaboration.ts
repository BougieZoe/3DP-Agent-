/**
 * Collaboration Module
 * 
 * Real-time collaboration features:
 * - Analysis sharing via links
 * - Comment system on analysis results
 * - Team workflow management
 * - Version history tracking
 * - Activity feed
 * 
 * HONESTY NOTE: This is a client-side module that provides the data structures
 * and interfaces for collaboration. In production, these would be backed by
 * a real-time database (e.g., Firebase, Supabase, or custom WebSocket server).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareLink {
  /** Unique share ID */
  id: string;
  /** Analysis ID being shared */
  analysisId: string;
  /** Creator user ID */
  createdBy: string;
  /** Creation timestamp */
  createdAt: string;
  /** Expiration timestamp (optional) */
  expiresAt?: string;
  /** Access level */
  accessLevel: "view" | "comment" | "edit";
  /** Password protection (optional) */
  passwordProtected: boolean;
  /** Number of views */
  viewCount: number;
  /** Whether link is active */
  active: boolean;
}

export interface Comment {
  /** Unique comment ID */
  id: string;
  /** Analysis ID */
  analysisId: string;
  /** Parent comment ID (for replies) */
  parentId?: string;
  /** Author user ID */
  authorId: string;
  /** Author display name */
  authorName: string;
  /** Author avatar URL */
  authorAvatar?: string;
  /** Comment content */
  content: string;
  /** Comment type */
  type: "text" | "annotation" | "suggestion" | "issue";
  /** Position on model (optional) */
  position?: {
    x: number;
    y: number;
    z: number;
  };
  /** Associated analysis module (optional) */
  relatedModule?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Whether comment is resolved */
  resolved: boolean;
  /** Reactions */
  reactions: Reaction[];
  /** Mentions */
  mentions: string[];
  /** Replies to this comment */
  replies?: Comment[];
}

export interface Reaction {
  /** Reaction type */
  type: "like" | "agree" | "disagree" | "question" | "important";
  /** User ID */
  userId: string;
  /** Timestamp */
  createdAt: string;
}

export interface TeamMember {
  /** User ID */
  id: string;
  /** Display name */
  name: string;
  /** Avatar URL */
  avatar?: string;
  /** Email */
  email: string;
  /** Role */
  role: "owner" | "admin" | "member" | "viewer";
  /** Join date */
  joinedAt: string;
  /** Last active */
  lastActive: string;
  /** Permission level */
  permissions: Permission[];
}

export interface Permission {
  /** Resource type */
  resource: "analysis" | "project" | "team";
  /** Action */
  action: "create" | "read" | "update" | "delete" | "share";
  /** Granted */
  granted: boolean;
}

export interface Project {
  /** Project ID */
  id: string;
  /** Project name */
  name: string;
  /** Description */
  description: string;
  /** Owner user ID */
  ownerId: string;
  /** Team members */
  members: TeamMember[];
  /** Analysis IDs in project */
  analysisIds: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last updated */
  updatedAt: string;
  /** Tags */
  tags: string[];
  /** Visibility */
  visibility: "private" | "team" | "public";
}

export interface AnalysisVersion {
  /** Version ID */
  id: string;
  /** Analysis ID */
  analysisId: string;
  /** Version number */
  version: number;
  /** Changes description */
  description: string;
  /** Author user ID */
  authorId: string;
  /** Timestamp */
  timestamp: string;
  /** Snapshot of analysis result */
  snapshot: Record<string, unknown>;
  /** Whether this is a major version */
  majorVersion: boolean;
}

export interface Activity {
  /** Activity ID */
  id: string;
  /** Activity type */
  type: "comment" | "edit" | "share" | "version" | "join" | "leave";
  /** User ID */
  userId: string;
  /** User name */
  userName: string;
  /** Resource type */
  resourceType: "analysis" | "project" | "comment";
  /** Resource ID */
  resourceId: string;
  /** Resource name */
  resourceName: string;
  /** Activity description */
  description: string;
  /** Timestamp */
  timestamp: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface CollaborationState {
  /** Current user */
  currentUser: TeamMember | null;
  /** Current project */
  currentProject: Project | null;
  /** Share links for current analysis */
  shareLinks: ShareLink[];
  /** Comments for current analysis */
  comments: Comment[];
  /** Team members */
  teamMembers: TeamMember[];
  /** Activity feed */
  activities: Activity[];
  /** Analysis versions */
  versions: AnalysisVersion[];
  /** Loading states */
  loading: {
    comments: boolean;
    shareLinks: boolean;
    team: boolean;
    activities: boolean;
  };
  /** Error states */
  errors: {
    comments: string | null;
    shareLinks: string | null;
    team: string | null;
    activities: string | null;
  };
}

// ---------------------------------------------------------------------------
// API Interfaces
// ---------------------------------------------------------------------------

export interface CollaborationAPI {
  // Share links
  createShareLink(analysisId: string, options: Partial<ShareLink>): Promise<ShareLink>;
  getShareLinks(analysisId: string): Promise<ShareLink[]>;
  revokeShareLink(linkId: string): Promise<void>;
  validateShareLink(linkId: string, password?: string): Promise<boolean>;

  // Comments
  addComment(comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt' | 'reactions'>): Promise<Comment>;
  getComments(analysisId: string): Promise<Comment[]>;
  updateComment(commentId: string, content: string): Promise<Comment>;
  deleteComment(commentId: string): Promise<void>;
  resolveComment(commentId: string): Promise<Comment>;
  addReaction(commentId: string, reaction: Omit<Reaction, 'createdAt'>): Promise<Comment>;

  // Team
  getTeamMembers(projectId: string): Promise<TeamMember[]>;
  inviteMember(projectId: string, email: string, role: TeamMember['role']): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  updateMemberRole(projectId: string, userId: string, role: TeamMember['role']): Promise<void>;

  // Projects
  createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  updateProject(projectId: string, updates: Partial<Project>): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  listProjects(userId: string): Promise<Project[]>;

  // Versions
  createVersion(analysisId: string, description: string, snapshot: Record<string, unknown>): Promise<AnalysisVersion>;
  getVersions(analysisId: string): Promise<AnalysisVersion[]>;
  restoreVersion(versionId: string): Promise<void>;

  // Activity
  getActivity(projectId: string, limit?: number): Promise<Activity[]>;
  logActivity(activity: Omit<Activity, 'id' | 'timestamp'>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new comment
 */
export function createComment(
  analysisId: string,
  authorId: string,
  authorName: string,
  content: string,
  type: Comment['type'] = 'text',
  options: Partial<Comment> = {}
): Omit<Comment, 'id' | 'createdAt' | 'updatedAt' | 'reactions'> {
  return {
    analysisId,
    authorId,
    authorName,
    content,
    type,
    resolved: false,
    mentions: [],
    ...options,
  };
}

/**
 * Create a new share link
 */
export function createShareLink(
  analysisId: string,
  createdBy: string,
  options: Partial<ShareLink> = {}
): Omit<ShareLink, 'id' | 'createdAt' | 'viewCount' | 'active'> {
  return {
    analysisId,
    createdBy,
    accessLevel: 'view',
    passwordProtected: false,
    ...options,
  };
}

/**
 * Check if user has permission
 */
export function hasPermission(
  member: TeamMember,
  resource: Permission['resource'],
  action: Permission['action']
): boolean {
  // Owner has all permissions
  if (member.role === 'owner') return true;
  
  // Check explicit permissions
  const permission = member.permissions.find(
    p => p.resource === resource && p.action === action
  );
  
  if (permission) return permission.granted;
  
  // Default permissions by role
  switch (member.role) {
    case 'admin':
      return true;
    case 'member':
      return action !== 'delete';
    case 'viewer':
      return action === 'read';
    default:
      return false;
  }
}

/**
 * Format activity description
 */
export function formatActivityDescription(activity: Activity): string {
  switch (activity.type) {
    case 'comment':
      return `${activity.userName} commented on ${activity.resourceName}`;
    case 'edit':
      return `${activity.userName} edited ${activity.resourceName}`;
    case 'share':
      return `${activity.userName} shared ${activity.resourceName}`;
    case 'version':
      return `${activity.userName} created a new version of ${activity.resourceName}`;
    case 'join':
      return `${activity.userName} joined the team`;
    case 'leave':
      return `${activity.userName} left the team`;
    default:
      return `${activity.userName} performed an action on ${activity.resourceName}`;
  }
}

/**
 * Get relative time string
 */
export function getRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
