import React from 'react';

interface ReputationBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

function getColor(score: number): string {
  if (score >= 80) return 'text-green-400 border-green-500';
  if (score >= 60) return 'text-yellow-400 border-yellow-500';
  if (score >= 40) return 'text-orange-400 border-orange-500';
  return 'text-red-400 border-red-500';
}

function getLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

export function ReputationBadge({ score, size = 'md' }: ReputationBadgeProps) {
  const colorClass = getColor(score);
  const label = getLabel(score);

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <div className={`inline-flex items-center gap-1 border rounded ${colorClass} ${sizeClasses[size]}`}>
      <span className="font-bold font-mono">{score}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  );
}
