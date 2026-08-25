/**
 * Activity Feed Component
 * 
 * Displays recent activity in a project:
 * - Comments
 * - Edits
 * - Shares
 * - Version changes
 * - Team changes
 */

import { cn } from '@/lib/utils';
import { 
  MessageSquare, 
  Edit2, 
  Share2, 
  History, 
  UserPlus, 
  UserMinus,
  Clock
} from 'lucide-react';
import type { Activity } from '@/lib/collaboration';
import { getRelativeTime } from '@/lib/collaboration';

interface ActivityFeedProps {
  activities: Activity[];
  limit?: number;
  showHeader?: boolean;
}

export function ActivityFeed({ 
  activities, 
  limit = 10,
  showHeader = true 
}: ActivityFeedProps) {
  const displayActivities = activities.slice(0, limit);

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'comment': return <MessageSquare size={16} />;
      case 'edit': return <Edit2 size={16} />;
      case 'share': return <Share2 size={16} />;
      case 'version': return <History size={16} />;
      case 'join': return <UserPlus size={16} />;
      case 'leave': return <UserMinus size={16} />;
      default: return <Clock size={16} />;
    }
  };

  const getActivityColor = (type: Activity['type']) => {
    switch (type) {
      case 'comment': return 'text-blue-600 bg-blue-50';
      case 'edit': return 'text-orange-600 bg-orange-50';
      case 'share': return 'text-green-600 bg-green-50';
      case 'version': return 'text-purple-600 bg-purple-50';
      case 'join': return 'text-teal-600 bg-teal-50';
      case 'leave': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Recent Activity</h3>
          <span className="text-xs text-muted-foreground">
            {activities.length} total
          </span>
        </div>
      )}

      {displayActivities.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Clock size={48} className="mx-auto mb-4 opacity-50" />
          <p>No activity yet</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {displayActivities.map((activity, index) => (
              <div key={activity.id} className="relative flex gap-3">
                {/* Icon */}
                <div className={cn(
                  "relative z-10 flex items-center justify-center w-8 h-8 rounded-full",
                  getActivityColor(activity.type)
                )}>
                  {getActivityIcon(activity.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="text-sm">
                    <span className="font-medium">{activity.userName}</span>
                    {' '}
                    <span className="text-muted-foreground">{activity.description}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {getRelativeTime(activity.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activities.length > limit && (
        <div className="text-center">
          <button className="text-sm text-primary hover:underline">
            View all {activities.length} activities
          </button>
        </div>
      )}
    </div>
  );
}
