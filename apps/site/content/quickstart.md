# Quick start

About five minutes, once [installed](/install/).

1. **Sign the computer in.** `agentdeck login` emails you a sign-in link; open it, then paste
   the link back into the terminal.
2. **Add an agent account.** `agentdeck profile add claude --name Work` creates an isolated
   profile and runs the agent's own login. Add as many as you like, of any agent.
3. **Add a repository.** `agentdeck repo add ~/src/my-app`.
4. **Open the app** and sign in with the same email. Your computer shows up under Work.
5. **Start a task:** New task → the computer → the repo → describe the work. The agent gets
   a fresh branch (a git worktree) and starts; its replies stream in.
6. **Approve** what it asks for, from the chat or the notification.
7. **Review and ship:** the worktree's Changes tab shows the diff; Ship commits, pushes and
   opens a pull request, with a description the agent drafts.

Next: the [guide](/docs/guide/) covers everything else.
