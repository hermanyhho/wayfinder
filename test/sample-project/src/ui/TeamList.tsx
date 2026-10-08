import { UserCard } from "./UserCard";

export function TeamList({ members }: { members: { name: string; photoUrl?: string }[] }) {
  return (
    <ul>
      {members.map((member) => (
        <li key={member.name}>
          <UserCard name={member.name} photoUrl={member.photoUrl} compact />
        </li>
      ))}
    </ul>
  );
}
