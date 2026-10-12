export const HELP = `agentdeck — drive coding agents on this machine

  agentdeck daemon                              run the daemon in the foreground
  agentdeck repo add <path>                     add a git repository
  agentdeck profile add <agent> --name <name>   create a profile and log it in
  agentdeck relay set <url> | relay status      choose the relay your devices connect through
  agentdeck login [--print]                     link this computer to your account
  agentdeck logout                              unlink this computer from your account
  agentdeck hosts                               list your account's computers
  agentdeck devices [revoke <id>]               list or remove your phones and browsers
  agentdeck install [--dry-run]                 start the daemon when you log in
  agentdeck open [--print]                      open the desktop web UI (one-time link)
  agentdeck dev send <command> ['<json args>']  send one command, print the reply
        [--cmd-id <cmd_…>] [--json]
  agentdeck dev watch [topic …] [--from <n>]    print events (default: global repo:* chat:*)
  agentdeck dev blob <file> [--mime <type>]     upload a file, print its BlobRef

The daemon's folder comes from AGENTDECK_HOME (or the OS default).`;
