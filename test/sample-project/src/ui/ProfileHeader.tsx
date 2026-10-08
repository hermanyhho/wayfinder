import { UserCard } from "./UserCard";

export function ProfileHeader({ name }: { name: string }) {
  return (
    <header>
      <UserCard name={name} />
    </header>
  );
}
