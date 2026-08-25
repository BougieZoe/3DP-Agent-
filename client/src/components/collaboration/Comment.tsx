/**
 * Comment Component
 * 
 * Displays and manages comments on analysis results.
 * Supports:
 * - Threaded comments
 * - Rich text formatting
 * - @mentions
 * - Reactions
 * - Resolution status
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  MessageSquare, 
  Check, 
  MoreHorizontal, 
  Reply, 
  Trash2, 
  Edit2,
  Heart,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Star
} from 'lucide-react';
import type { Comment, Reaction } from '@/lib/collaboration';
import { getRelativeTime } from '@/lib/collaboration';

interface CommentProps {
  comment: Comment;
  currentUserId?: string;
  onReply?: (commentId: string) => void;
  onResolve?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
  onReact?: (commentId: string, reactionType: Reaction['type']) => void;
  isReply?: boolean;
}

export function CommentComponent({
  comment,
  currentUserId,
  onReply,
  onResolve,
  onDelete,
  onEdit,
  onReact,
  isReply = false,
}: CommentProps) {
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  const isAuthor = currentUserId === comment.authorId;
  const hasReacted = comment.reactions.some(r => r.userId === currentUserId);

  const reactionCounts = comment.reactions.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getReactionIcon = (type: Reaction['type']) => {
    switch (type) {
      case 'like': return <Heart size={14} />;
      case 'agree': return <ThumbsUp size={14} />;
      case 'disagree': return <ThumbsDown size={14} />;
      case 'question': return <AlertCircle size={14} />;
      case 'important': return <Star size={14} />;
      default: return <Heart size={14} />;
    }
  };

  return (
    <div
      className={cn(
        "group relative",
        isReply ? "ml-8 mt-2" : "mt-4",
        comment.resolved && "opacity-60"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {comment.authorAvatar ? (
            <img
              src={comment.authorAvatar}
              alt={comment.authorName}
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
              {comment.authorName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{comment.authorName}</span>
            <span className="text-xs text-muted-foreground">
              {getRelativeTime(comment.createdAt)}
            </span>
            {comment.resolved && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <Check size={12} />
                Resolved
              </span>
            )}
          </div>

          <div className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</div>

          {/* Reactions */}
          {Object.keys(reactionCounts).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(reactionCounts).map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => onReact?.(comment.id, type as Reaction['type'])}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                    "border transition-colors",
                    hasReacted
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-muted border-transparent hover:bg-muted/80"
                  )}
                >
                  {getReactionIcon(type as Reaction['type'])}
                  <span>{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          {showActions && (
            <div className="flex items-center gap-1 mt-2">
              <button
                onClick={() => onReply?.(comment.id)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
              >
                <Reply size={12} />
                Reply
              </button>
              
              <button
                onClick={() => setShowReactions(!showReactions)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
              >
                React
              </button>

              {isAuthor && (
                <>
                  <button
                    onClick={() => onEdit?.(comment.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
                  >
                    <Edit2 size={12} />
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete?.(comment.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-destructive hover:text-destructive/80 rounded hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </>
              )}

              {!comment.resolved && (
                <button
                  onClick={() => onResolve?.(comment.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:text-green-700 rounded hover:bg-green-50 transition-colors"
                >
                  <Check size={12} />
                  Resolve
                </button>
              )}
            </div>
          )}

          {/* Reaction picker */}
          {showReactions && (
            <div className="flex gap-1 mt-2 p-2 bg-muted rounded-lg">
              {(['like', 'agree', 'disagree', 'question', 'important'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => {
                    onReact?.(comment.id, type);
                    setShowReactions(false);
                  }}
                  className="p-1.5 rounded hover:bg-background transition-colors"
                  title={type}
                >
                  {getReactionIcon(type)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-11">
          {comment.replies.map(reply => (
            <CommentComponent
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              onReply={onReply}
              onResolve={onResolve}
              onDelete={onDelete}
              onEdit={onEdit}
              onReact={onReact}
              isReply
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CommentListProps {
  comments: Comment[];
  currentUserId?: string;
  onAddComment?: (content: string, type: Comment['type']) => void;
  onReply?: (commentId: string, content: string) => void;
  onResolve?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string, content: string) => void;
  onReact?: (commentId: string, reactionType: Reaction['type']) => void;
}

export function CommentList({
  comments,
  currentUserId,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onEdit,
  onReact,
}: CommentListProps) {
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState<Comment['type']>('text');

  const handleSubmit = () => {
    if (newComment.trim()) {
      onAddComment?.(newComment.trim(), commentType);
      setNewComment('');
    }
  };

  const rootComments = comments.filter(c => !c.parentId);

  return (
    <div className="space-y-4">
      {/* Add comment */}
      <div className="flex gap-3">
        <div className="flex-1">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full p-3 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            rows={3}
          />
          <div className="flex items-center justify-between mt-2">
            <select
              value={commentType}
              onChange={(e) => setCommentType(e.target.value as Comment['type'])}
              className="text-xs border rounded px-2 py-1"
            >
              <option value="text">Comment</option>
              <option value="suggestion">Suggestion</option>
              <option value="issue">Issue</option>
              <option value="annotation">Annotation</option>
            </select>
            <button
              onClick={handleSubmit}
              disabled={!newComment.trim()}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Post Comment
            </button>
          </div>
        </div>
      </div>

      {/* Comments list */}
      <div className="space-y-2">
        {rootComments.map(comment => (
          <CommentComponent
            key={comment.id}
            comment={comment}
            currentUserId={currentUserId}
            onReply={(commentId) => {
              const reply = prompt('Enter your reply:');
              if (reply) onReply?.(commentId, reply);
            }}
            onResolve={onResolve}
            onDelete={onDelete}
            onEdit={(commentId) => {
              const newContent = prompt('Edit your comment:', comment.content);
              if (newContent) onEdit?.(commentId, newContent);
            }}
            onReact={onReact}
          />
        ))}
      </div>

      {rootComments.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
          <p>No comments yet. Be the first to comment!</p>
        </div>
      )}
    </div>
  );
}
