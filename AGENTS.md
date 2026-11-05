# Development instructions

- This repository contains an independent DSH publishing plugin.
- Keep DSH integration, Bilibili API access, credential providers and upload adapters in separate modules.
- Never add account cookies, tokens, server credentials, personal conversations, diaries, drafts or media to the repository.
- Use explicit local configuration for credential paths and runtime directories. Keep the plugin portable across users and machines.
- Support standalone account configuration and an optional adapter for dsh-bili-whale credentials.
- Previewing content must not upload media or submit a post.
- Publishing must reflect an explicit user publishing request. A request to draft content is not a publishing request.
- Keep submission identifiers and uncertain outcomes so retries do not silently create duplicate posts.
- Never describe code skeletons, mock test results or previews as successful live publication.
- Validate meaningful publishing behavior with mock network tests before live integration. Live publication requires content the user has authorized to publish.
- For every implementation change, update the documented feature status and run the relevant checks.
- Do not deploy to a server merely because a commit was pushed.
