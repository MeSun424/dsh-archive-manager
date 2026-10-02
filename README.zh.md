# DSH 归档管理插件

[English](README.md) | 中文

为 DeepSeek Harness 提供按项目管理归档聊天的功能。你可以在 **设置 > 已归档聊天** 中查找、恢复或删除聊天，也可以将整个工作区归档，保留其中聊天的项目归属。

![归档管理页面](assets/archive-manager-preview.png)

## 功能

- 按项目查看已归档聊天，未归属项目的聊天单独显示。
- 按标题、项目名称、工作目录或会话 ID 搜索，支持项目筛选和排序。
- 取消单条聊天的归档，或恢复整个已归档工作区。
- 归档工作区时保留项目与聊天的关联，空工作区也可以归档和恢复。
- 永久删除单条聊天、某个项目的全部归档聊天，或所有归档聊天。

插件沿用 DeepSeek Harness 的界面样式，支持浅色和深色主题，不上传聊天内容。

## 兼容版本

| 版本 | 支持范围 |
| --- | --- |
| DeepSeek Harness 桌面版 | 已验证 `0.2.0-rc.2` |
| DeepSeek Harness Web 版 | `0.1.2-alpha.1`、`0.1.2-alpha.2`、`0.1.2-rc.1`、`0.1.5-rc.1` |

其他版本尚未验证。永久删除功能适用于 DeepSeek Harness 默认的本地会话存储；使用其他存储方式时，该操作可能不可用。

## 安装

### 桌面版

完全退出 DeepSeek Harness，然后在终端中使用桌面版自带的 `dsh` 命令安装：

```sh
dsh plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

如果终端提示找不到 `dsh`，macOS 用户可以直接运行以下命令，无需另行安装 CLI：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

安装后重新打开桌面版，进入 **设置 > 已归档聊天**。

### Web 版

```sh
dsh plugin --profile web add github:MeSun424/dsh-archive-manager
```

安装后重启 DeepSeek Harness Web，进入 **设置 > 已归档聊天**。

## 使用

### 归档与恢复聊天

在聊天菜单中选择 **归档**，聊天会从日常列表移入归档。归档保留聊天内容，并取消该聊天的置顶状态。

需要继续使用时，在归档页面找到聊天，点击 **取消归档**。如果归档时提示仍有任务在运行，请先停止相关任务，再执行归档。

### 归档与恢复工作区

启用插件后，工作区菜单中的 **删除工作区** 会改为 **归档工作区**。该操作将工作区及其聊天一并归档，保留项目关系和原目录中的文件。

在归档页面打开项目右侧的 **…** 菜单，选择 **恢复项目**，即可恢复工作区和此次随工作区归档的聊天。之前已单独归档的聊天仍保持归档状态。

如果原目录不存在，页面会显示 **路径不存在**，并允许选择目录尝试恢复。选择其他目录只改变聊天的项目归属，不会迁移文件或修改聊天原有的工作目录；继续对话时可能仍需访问原目录。建议优先恢复原目录后再恢复项目。

### 永久删除聊天

单条聊天右侧的删除按钮用于删除该聊天；项目菜单中的 **删除项目中的全部归档聊天** 用于删除该项目的归档聊天；页面右上角的 **全部删除** 用于删除所有归档聊天。操作前均会显示确认框。

**永久删除会移除本地聊天记录，无法撤销。** 删除项目归档时，被搜索隐藏的聊天也会包含在内，请以确认框中的数量为准。项目文件和未归档聊天不受影响。

批量删除如有条目未能完成，页面会显示原因，其余条目仍会继续处理。如果提示聊天文件已删除、但清理未完成，可重试删除以完成剩余清理。

插件还会自动清理已脱离工作区且没有对话内容的空白记录，不清理仍有对话内容的聊天。

## 更新与卸载

更新桌面版插件前，请完全退出 DeepSeek Harness，再移除旧版并重新安装：

```sh
dsh plugin --profile desktop remove dsh-archive-manager
dsh plugin --profile desktop add github:MeSun424/dsh-archive-manager
```

更新后重新打开桌面版。Web 版使用相同命令，将 `desktop` 替换为 `web`，完成后重启 Web 服务。

仅卸载插件时，执行对应版本的 `remove` 命令即可：

```sh
# 桌面版
dsh plugin --profile desktop remove dsh-archive-manager

# Web 版
dsh plugin --profile web remove dsh-archive-manager
```

如果 macOS 上无法直接使用 `dsh`，可将命令中的 `dsh` 替换为安装章节中的完整路径。

更新或卸载插件不会删除已有聊天及归档记录，也不会恢复已经永久删除的聊天。插件不修改 DeepSeek Harness 核心程序。

## 许可证

[MIT](LICENSE)
