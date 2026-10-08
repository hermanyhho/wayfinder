import { Image } from "./Image";

interface AvatarProps {
  name: string;
  photoUrl?: string;
}

export function Avatar({ name, photoUrl }: AvatarProps) {
  if (!photoUrl) return <span className="avatar-initials">{name.slice(0, 1)}</span>;
  return <Image src={photoUrl} alt={name} />;
}
