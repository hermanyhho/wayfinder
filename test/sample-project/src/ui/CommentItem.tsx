import { UserCard } from "./UserCard";

export function CommentItem({ author, text }: { author: string; text: string }) {
  return (
    <article>
      <UserCard name={author} compact />
      <p>{text}</p>
    </article>
  );
}
