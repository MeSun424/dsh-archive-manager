# DSH Archive Manager

English | [中文](README.zh.md)

Manage archived chats by project in DeepSeek Harness. Find, restore, or delete chats from **Settings > Archived chats**, or archive an entire workspace while keeping its chats grouped under the original project.

![Archive management page](assets/archive-manager-preview.png)

## Features

- Browse archived chats by project, with a separate group for unassigned chats.
- Search by title, project name, working directory, or session ID. Filter by project and sort the results.
- Unarchive individual chats or restore an entire archived workspace.
- Keep project membership when archiving a workspace. Empty workspaces can also be archived and restored.
- Permanently delete individual chats, all archived chats in a project, or all archived chats.

The plugin follows the DeepSeek Harness interface and supports light and dark themes. It does not upload chat content.

## Compatibility

| Edition | Supported versions |
| --- | --- |
| DeepSeek Harness Desktop | Verified with `0.2.0-rc.2` |
| DeepSeek Harness Web | `0.1.2-alpha.1`, `0.1.2-alpha.2`, `0.1.2-rc.1`, `0.1.5-rc.1` |

Other versions have not been verified. Permanent deletion supports the default local session storage in DeepSeek Harness; it may be unavailable with other storage options.

## Installation

### Desktop

Fully quit DeepSeek Harness, then install the plugin from a terminal using the `dsh` command included with Desktop:

```sh
dsh plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

If your terminal cannot find `dsh`, macOS users can run the following command directly. A separate CLI installation is not required:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

Reopen Desktop and go to **Settings > Archived chats**.

### Web

```sh
dsh plugin --profile web add github:MeSun424/dsh-archive-manager
```

Restart DeepSeek Harness Web, then go to **Settings > Archived chats**.

## Usage

### Archive and restore chats

Choose **Archive** from a chat's menu to move it from the regular list into the archive. The chat's content is retained, and its pin is removed.

To use it again, find the chat on the archive page and choose **Unarchive**. If archiving is blocked because tasks are still running, stop those tasks and try again.

### Archive and restore workspaces

When the plugin is enabled, **Delete workspace** becomes **Archive workspace**. This archives the workspace and its chats together, preserving project membership and the files in the original directory.

On the archive page, open the project's **…** menu and choose **Restore project**. This restores the workspace and the chats archived with it. Chats that were already archived individually remain archived.

If the original directory is missing, the page marks it as unavailable and lets you select a directory to attempt a restore. Selecting another directory changes project membership only; it does not move files or change the chat's original working directory. Continued chats may still need the original path. Restore that directory before restoring the project whenever possible.

### Permanently delete chats

Use the delete button beside a chat to delete that chat, the project menu to delete all archived chats in that project, or **Delete all** at the top of the page to delete every archived chat. Each action requires confirmation.

**Permanent deletion removes local chat records and cannot be undone.** Project deletion includes archived chats hidden by search, so check the count in the confirmation dialog. Project files and unarchived chats are kept.

If some entries cannot be deleted in a batch, the page reports the reason and continues with the other entries. If an error says that chat files were deleted but cleanup is incomplete, retry deletion to finish the remaining cleanup.

The plugin also removes empty records that no longer belong to a workspace and contain no conversation content. Chats with conversation content are kept.

## Updating and uninstalling

To update the Desktop plugin, fully quit DeepSeek Harness, remove the installed version, and install it again:

```sh
dsh plugin --profile desktop remove dsh-archive-manager
dsh plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

Reopen Desktop after updating. For Web, replace `desktop` with `web` in these commands, then restart the Web service.

To uninstall, run the `remove` command for your edition:

```sh
# Desktop
dsh plugin --profile desktop remove dsh-archive-manager

# Web
dsh plugin --profile web remove dsh-archive-manager
```

If `dsh` is not available in your macOS terminal, replace it with the full path shown in the installation section.

Updating or uninstalling the plugin does not delete existing chats or archive records. It does not recover chats that were permanently deleted. The plugin does not modify the DeepSeek Harness core application.

## License

[MIT](LICENSE)
