import { Avatar } from "./Avatar";

interface UserCardProps {
  name: string;
  photoUrl?: string;
  compact?: boolean;
}

export function UserCard({ name, photoUrl, compact = false }: UserCardProps) {
  return (
    <div className={compact ? "user-card compact" : "user-card"}>
      <Avatar name={name} photoUrl={photoUrl} />
      {!compact && <strong>{name}</strong>}
    </div>
  );
}
