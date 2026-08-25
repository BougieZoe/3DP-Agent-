/**
 * Share Dialog Component
 * 
 * Provides sharing functionality for analysis results:
 * - Generate share links
 * - Set access levels
 * - Copy to clipboard
 * - Manage existing shares
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Link, 
  Copy, 
  Check, 
  Globe, 
  Lock, 
  Eye, 
  MessageSquare, 
  Edit2,
  Trash2,
  RefreshCw,
  Share2
} from 'lucide-react';
import type { ShareLink } from '@/lib/collaboration';

interface ShareDialogProps {
  analysisId: string;
  shareLinks: ShareLink[];
  onCreateLink: (options: Partial<ShareLink>) => Promise<ShareLink>;
  onRevokeLink: (linkId: string) => Promise<void>;
  onCopyLink: (link: string) => void;
  onClose: () => void;
}

export function ShareDialog({
  analysisId,
  shareLinks,
  onCreateLink,
  onRevokeLink,
  onCopyLink,
  onClose,
}: ShareDialogProps) {
  const [accessLevel, setAccessLevel] = useState<ShareLink['accessLevel']>('view');
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [password, setPassword] = useState('');
  const [expiryDays, setExpiryDays] = useState<number | undefined>(undefined);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const handleCreateLink = async () => {
    setIsCreating(true);
    try {
      const link = await onCreateLink({
        accessLevel,
        passwordProtected,
        expiresAt: expiryDays 
          ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      });
      // In production, the link would include the actual share URL
      const shareUrl = `${window.location.origin}/share/${link.id}`;
      onCopyLink(shareUrl);
      setCopiedLink(shareUrl);
      setTimeout(() => setCopiedLink(null), 2000);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyLink = (linkId: string) => {
    const shareUrl = `${window.location.origin}/share/${linkId}`;
    onCopyLink(shareUrl);
    setCopiedLink(shareUrl);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const getAccessLevelIcon = (level: ShareLink['accessLevel']) => {
    switch (level) {
      case 'view': return <Eye size={16} />;
      case 'comment': return <MessageSquare size={16} />;
      case 'edit': return <Edit2 size={16} />;
    }
  };

  const getAccessLevelLabel = (level: ShareLink['accessLevel']) => {
    switch (level) {
      case 'view': return 'View only';
      case 'comment': return 'Can comment';
      case 'edit': return 'Can edit';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-background rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Share2 size={20} />
            <h2 className="text-lg font-semibold">Share Analysis</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded"
          >
            ×
          </button>
        </div>

        {/* Create new link */}
        <div className="p-4 border-b">
          <h3 className="text-sm font-medium mb-3">Create new share link</h3>
          
          <div className="space-y-3">
            {/* Access level */}
            <div>
              <label className="text-xs text-muted-foreground">Access level</label>
              <div className="flex gap-2 mt-1">
                {(['view', 'comment', 'edit'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setAccessLevel(level)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors",
                      accessLevel === level
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted border-transparent hover:bg-muted/80"
                    )}
                  >
                    {getAccessLevelIcon(level)}
                    {getAccessLevelLabel(level)}
                  </button>
                ))}
              </div>
            </div>

            {/* Password protection */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="passwordProtected"
                checked={passwordProtected}
                onChange={(e) => setPasswordProtected(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="passwordProtected" className="text-sm flex items-center gap-2">
                <Lock size={14} />
                Password protected
              </label>
            </div>

            {passwordProtected && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
            )}

            {/* Expiry */}
            <div>
              <label className="text-xs text-muted-foreground">Link expires in (optional)</label>
              <select
                value={expiryDays ?? ''}
                onChange={(e) => setExpiryDays(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-lg"
              >
                <option value="">Never</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>

            {/* Create button */}
            <button
              onClick={handleCreateLink}
              disabled={isCreating}
              className="w-full px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {isCreating ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create share link'
              )}
            </button>
          </div>
        </div>

        {/* Existing links */}
        <div className="p-4 max-h-64 overflow-y-auto">
          <h3 className="text-sm font-medium mb-3">Existing share links</h3>
          
          {shareLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No share links created yet
            </p>
          ) : (
            <div className="space-y-2">
              {shareLinks.map(link => (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {link.passwordProtected ? (
                      <Lock size={16} className="text-muted-foreground" />
                    ) : (
                      <Globe size={16} className="text-muted-foreground" />
                    )}
                    <div>
                      <div className="text-sm font-medium">
                        {getAccessLevelLabel(link.accessLevel)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {link.viewCount} views
                        {link.expiresAt && ` · Expires ${new Date(link.expiresAt).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopyLink(link.id)}
                      className="p-2 hover:bg-background rounded transition-colors"
                      title="Copy link"
                    >
                      {copiedLink === `${window.location.origin}/share/${link.id}` ? (
                        <Check size={16} className="text-green-600" />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                    <button
                      onClick={() => onRevokeLink(link.id)}
                      className="p-2 hover:bg-destructive/10 text-destructive rounded transition-colors"
                      title="Revoke link"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-muted rounded-lg hover:bg-muted/80"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
