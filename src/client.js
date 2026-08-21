import React from 'react'
import {
  IconArchiveOutline20,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconFolderOpen16,
  IconFolderOpenOutline16,
  IconListPenOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'

const CSS_ID = 'dsh-archive-manager/client'
const ARCHIVE_ICON_PATH = 'M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z'
const ARCHIVE_ICON_LINE_PATH = 'M12.7962 12.5661V11.0832H7.20548V12.5661L12.7962 12.5661Z'
const UI = {
  open: false,
  revision: 0,
  listeners: new Set(),
  setOpen(open) {
    if (UI.open === open) return
    UI.open = open
    UI.revision += 1
    for (const listener of UI.listeners) listener()
  },
  subscribe(listener) {
    UI.listeners.add(listener)
    return () => UI.listeners.delete(listener)
  },
  snapshot() {
    return UI.revision
  },
}

const css = `
.dam-footer{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 0 0;margin-top:8px;min-width:0}
.dam-footer-button{display:flex;align-items:center;gap:8px;width:100%;height:38px;padding:0 12px;color:var(--dsw-alias-label-secondary);font:500 14px/22px var(--dsw-font-family);letter-spacing:0;background:transparent;border:0;border-radius:10px;cursor:pointer;text-align:left}
.dam-footer-button:hover,.dam-footer-button[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dam-footer-button:focus-visible,.dam-action:focus-visible,.dam-filter:focus-visible,.dam-delete-all:focus-visible,.dam-section-more:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}
.dam-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dam-overlay{position:fixed;inset:0;z-index:100;display:grid;grid-template-columns:280px minmax(0,1fr);pointer-events:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family);letter-spacing:0}
.dam-nav{display:flex;flex-direction:column;min-width:0;overflow:auto;padding:24px 16px 18px;background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}
.dam-nav-top{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.dam-back{display:inline-flex;align-items:center;gap:5px;padding:7px 8px;color:var(--dsw-alias-label-secondary);font:500 14px/22px var(--dsw-font-family);background:transparent;border:0;border-radius:8px;cursor:pointer}
.dam-back:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dam-nav-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 11px;margin-bottom:14px;color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:18px}
.dam-nav-search input{min-width:0;flex:1;color:var(--dsw-alias-label-primary);font:400 13px/20px var(--dsw-font-family);background:transparent;border:0;outline:0}
.dam-nav-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dam-nav-heading{padding:0 12px 5px;margin-top:8px;color:var(--dsw-alias-label-tertiary);font:500 12px/18px var(--dsw-font-family)}
.dam-nav-item{display:flex;align-items:center;gap:10px;width:100%;min-height:30px;padding:0 12px;color:var(--dsw-alias-label-primary);font:500 14px/22px var(--dsw-font-family);text-align:left;background:transparent;border:0;border-radius:8px;cursor:default}
.dam-nav-item-active{background:var(--dsw-specific-sidebar-nav-item-active)}
.dam-nav-icon{display:grid;place-items:center;flex:none;width:18px;height:18px;color:var(--dsw-alias-label-secondary)}
.dam-nav-caption{display:none}
.dam-main{min-width:0;min-height:0;overflow:auto;padding:64px 48px 72px;background:var(--dsw-alias-bg-base)}
.dam-main-inner{width:min(800px,100%);margin:0 auto}
.dam-header{position:relative;display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:34px}
.dam-title{margin:0;color:var(--dsw-alias-label-primary);font:600 30px/38px var(--dsw-font-family);letter-spacing:0;text-align:center}
.dam-subtitle{display:none}
.dam-close{display:none}
.dam-delete-all{position:absolute;right:0;top:0;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;color:var(--dsw-alias-state-error-primary);font:600 14px/22px var(--dsw-font-family);background:var(--dsw-alias-interactive-bg-hover-danger);border:0;border-radius:9px;cursor:pointer}
.dam-delete-all:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover-danger) 78%,var(--dsw-alias-state-error-primary))}
.dam-delete-all:disabled{opacity:.45;cursor:not-allowed}
.dam-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dam-toolbar{display:grid;grid-template-columns:minmax(0,1fr) 144px 176px;gap:8px;margin-bottom:38px}
.dam-search{display:flex;align-items:center;gap:8px;min-width:0;height:34px;padding:0 12px;color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:18px}
.dam-search:focus-within{border-color:var(--dsw-alias-border-l3)}
.dam-search input{min-width:0;flex:1;color:var(--dsw-alias-label-primary);font:400 14px/22px var(--dsw-font-family);background:transparent;border:0;outline:0}
.dam-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dam-filter{display:flex;align-items:center;justify-content:space-between;gap:7px;height:34px;padding:0 11px;color:var(--dsw-alias-label-secondary);font:500 14px/22px var(--dsw-font-family);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:17px;cursor:pointer}
.dam-filter select{min-width:0;flex:1;color:inherit;font:inherit;background:transparent;border:0;outline:0;appearance:none;cursor:pointer}
.dam-filter option{color:#202124;background:#fff}
.dam-filter-chevron{flex:none;color:var(--dsw-alias-label-caption)}
.dam-group-toggle{display:none}
.dam-section{margin-top:36px}
.dam-section:first-of-type{margin-top:0}
.dam-section-missing .dam-group{opacity:.58}
.dam-section-status{margin-left:8px;color:var(--dsw-alias-state-error-primary);font:400 11px/16px var(--dsw-font-family)}
.dam-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 13px;padding:0 1px;color:var(--dsw-alias-label-secondary);font:600 15px/22px var(--dsw-font-family)}
.dam-section-count{color:var(--dsw-alias-label-caption);font:400 12px/18px var(--dsw-font-family)}
.dam-section-more{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:8px;color:var(--dsw-alias-label-caption);font:600 16px/20px var(--dsw-font-family);background:transparent;border:0;border-radius:7px;cursor:pointer}
.dam-section-more:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dam-group{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:15px}
.dam-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:17px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
.dam-row:first-child{border-top:0}
.dam-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dam-row-copy{min-width:0}
.dam-row-title{overflow:hidden;color:var(--dsw-alias-label-primary);font:500 14px/22px var(--dsw-font-family);text-overflow:ellipsis;white-space:nowrap}
.dam-row-meta{display:flex;gap:8px;min-width:0;margin-top:4px;color:var(--dsw-alias-label-tertiary);font:400 12px/18px var(--dsw-font-family)}
.dam-row-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dam-row-actions{display:flex;align-items:center;gap:8px;flex:none}
.dam-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 11px;color:var(--dsw-alias-label-secondary);font:500 13px/20px var(--dsw-font-family);background:var(--dsw-alias-button-ghost-active-fill);border:0;border-radius:8px;cursor:pointer}
.dam-action:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dam-action:disabled{opacity:.45;cursor:not-allowed}
.dam-action-danger{color:var(--dsw-alias-state-error-primary);background:transparent}
.dam-action-danger:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dam-confirm-actions .dam-action-danger{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dam-confirm-actions .dam-action-danger:hover{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover-danger) 78%,var(--dsw-alias-state-error-primary))}
.dam-empty{padding:70px 20px;text-align:center;color:var(--dsw-alias-label-tertiary);font:400 14px/22px var(--dsw-font-family);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}
.dam-error{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;margin-bottom:18px;color:var(--dsw-alias-state-error-primary);font:400 13px/20px var(--dsw-font-family);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:10px}
.dam-error button{flex:none;color:inherit;font:600 13px/20px var(--dsw-font-family);background:transparent;border:0;cursor:pointer}
.dam-toast{position:fixed;top:18px;left:50%;z-index:140;display:flex;align-items:flex-start;gap:12px;width:min(680px,calc(100vw - 36px));padding:12px 16px;color:var(--dsw-alias-state-error-primary);font:500 13px/20px var(--dsw-font-family);background:var(--dsw-alias-interactive-bg-hover-danger);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 28%,transparent);border-radius:10px;box-shadow:var(--dsw-shadow-lv2);transform:translateX(-50%)}
.dam-toast button{flex:none;margin-left:auto;color:inherit;font:600 13px/20px var(--dsw-font-family);background:transparent;border:0;cursor:pointer}
.dam-confirm-backdrop{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 64%,transparent);backdrop-filter:blur(4px)}
.dam-confirm{width:min(440px,100%);padding:24px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:var(--dsw-shadow-lv3)}
.dam-confirm-title{margin:0;color:var(--dsw-alias-label-primary);font:600 18px/26px var(--dsw-font-family)}
.dam-confirm-copy{margin:10px 0 22px;color:var(--dsw-alias-label-secondary);font:400 14px/22px var(--dsw-font-family)}
.dam-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.dam-confirm-actions .dam-action{min-width:84px}
.dam-loading{opacity:.7;pointer-events:none}
.dam-settings-page{position:relative;width:100%;min-width:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.dam-settings-page .dam-main{min-height:0;overflow:visible;padding:0;background:transparent}
.dam-settings-page .dam-main-inner{width:100%;margin:0}
.dam-settings-page .dam-header{justify-content:space-between;margin-bottom:22px}
.dam-settings-page .dam-title{font-size:18px;line-height:26px;font-weight:600;text-align:left}
.dam-settings-page .dam-delete-all{box-sizing:border-box;position:static;height:28px;min-height:28px;padding:0 8px;gap:4px;border-radius:8px;font-size:11px;line-height:16px}
.dam-settings-page .dam-delete-all svg{width:13px;height:13px}
.dam-settings-page .dam-row-delete svg,.dam-settings-page .dam-group-menu svg{width:14px;height:14px}
.dam-settings-page .dam-toolbar{grid-template-columns:minmax(0,1fr) 126px 146px;gap:7px;margin-bottom:24px}
.dam-settings-page .dam-search,.dam-settings-page .dam-filter{height:34px}
.dam-settings-page .dam-section{margin-top:24px}
.dam-settings-page .dam-section-heading{font-size:14px;line-height:20px;margin-bottom:8px}
.dam-settings-page .dam-group{border-radius:12px}
.dam-settings-page .dam-row{padding:12px 12px;gap:10px}
.dam-settings-page .dam-row-title{font-size:13px;line-height:20px}
.dam-settings-page .dam-row-meta{margin-top:2px;font-size:11px;line-height:16px}
.dam-settings-page .dam-action{min-height:30px;padding:0 9px;font-size:12px}
.dam-settings-page .dam-row-delete{color:var(--dsw-alias-label-secondary);background:transparent}
.dam-settings-page .dam-row-delete:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dam-section-heading-title{display:inline-flex;align-items:center;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary)}
.dam-section-heading-title svg{display:block;flex:none}
.dam-section-heading-actions{display:inline-flex;align-items:center;gap:8px;flex:none}
.dam-section-menu-wrap{position:relative;display:inline-flex}
.dam-section-more{width:32px;height:32px;margin:0;padding:0;border-radius:8px}
.dam-section-more-glyph{display:block;line-height:1;transform:translateY(-6px)}
.dam-section-more[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dam-group-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:210px;padding:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:11px;box-shadow:var(--dsw-shadow-lv2)}
.dam-group-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 10px;color:var(--dsw-alias-state-error-primary);font:500 13px/20px var(--dsw-font-family);text-align:left;background:transparent;border:0;border-radius:7px;cursor:pointer}
.dam-group-menu button:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.dam-settings-page .dam-confirm-backdrop{position:absolute;inset:0;padding:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 64%,transparent)}
@media(max-width:820px){.dam-overlay{grid-template-columns:1fr}.dam-nav{display:none}.dam-main{padding:28px 18px 48px}.dam-toolbar{grid-template-columns:1fr}.dam-header{margin-bottom:20px}.dam-title{font-size:26px;line-height:34px}.dam-row{grid-template-columns:1fr;gap:12px}.dam-row-actions{justify-content:flex-end}}
@media(max-width:500px){.dam-row{padding:14px}.dam-action{padding-inline:8px}.dam-action span{display:none}}
`

function installStyles() {
  if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-archive-manager'
  style.dataset.pluginCss = CSS_ID
  style.textContent = css
  document.head.appendChild(style)
}

function createArchiveNavIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.dataset.damArchiveIcon = 'true'
  const box = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  box.setAttribute('fill-rule', 'evenodd')
  box.setAttribute('clip-rule', 'evenodd')
  box.setAttribute('d', ARCHIVE_ICON_PATH)
  box.setAttribute('fill', 'currentColor')
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line.setAttribute('d', ARCHIVE_ICON_LINE_PATH)
  line.setAttribute('fill', 'currentColor')
  svg.append(box, line)
  return svg
}

const SETTINGS_ROOT_SELECTOR = [
  '[data-slot="settings.overlay"]',
  '[data-slot="settings.nav"]',
  '[data-slot="settings.section"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.dam-settings-page',
].join(', ')

const SETTINGS_OVERLAY_SELECTOR = [
  '[data-slot="settings.overlay"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(', ')

function installSettingsRootObserver({ scan, onMutation, characterData = false }) {
  const roots = new Set()
  const rootObservers = new Map()
  const body = document.body

  const attach = (root) => {
    if (!(root instanceof Element) || roots.has(root)) return
    for (const existing of roots) {
      if (existing.contains(root)) return
    }
    roots.add(root)
    scan(root)
    const observer = new MutationObserver((records) => onMutation(records, root))
    observer.observe(root, { childList: true, subtree: true, characterData })
    rootObservers.set(root, observer)
  }

  const collect = (node, descend = false) => {
    if (!(node instanceof Element)) return
    if (node.matches(SETTINGS_ROOT_SELECTOR)) attach(node)
    if (!descend && !node.matches(SETTINGS_OVERLAY_SELECTOR)) return
    for (const root of node.querySelectorAll(SETTINGS_ROOT_SELECTOR)) attach(root)
  }

  // This one-time lookup handles a settings view that is already mounted.
  for (const root of document.querySelectorAll(SETTINGS_ROOT_SELECTOR)) attach(root)

  const bodyObserver = body === null ? null : new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) collect(node)
    }
  })
  bodyObserver?.observe(body, { childList: true })

  return () => {
    bodyObserver?.disconnect()
    for (const observer of rootObservers.values()) observer.disconnect()
    roots.clear()
    rootObservers.clear()
  }
}

function installArchiveNavIcon() {
  const replaceIcon = (label) => {
    if (!(label instanceof Element) || label.textContent?.trim() !== '已归档聊天') return
    const button = label.closest('button')
    const icon = button?.querySelector('svg')
    if (icon === null || icon === undefined || icon.dataset.damArchiveIcon === 'true') return
    icon.replaceWith(createArchiveNavIcon())
  }

  const scan = (root) => {
    if (!(root instanceof Element)) return
    if (root instanceof Element && root.matches('.VOzbGW_navLabel')) replaceIcon(root)
    for (const label of root.querySelectorAll('.VOzbGW_navLabel')) replaceIcon(label)
  }
  return installSettingsRootObserver({
    scan,
    onMutation(records) {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node)
      }
    },
  })
}

function installWorkspaceArchiveCopy() {
  const originals = new Map()
  const replaceText = (node) => {
    if (node.nodeType !== Node.TEXT_NODE || typeof node.nodeValue !== 'string') return
    const value = node.nodeValue
    let next = value
    if (value === '删除工作区') next = '归档工作区'
    else if (value === '正在删除工作区…') next = '正在归档工作区…'
    else if (value.startsWith('将把“') && value.endsWith('从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。')) {
      const name = value.slice(3, value.indexOf('”'))
      next = `将把“${name}”及其所有会话移入“已归档聊天”，并保留原工作区归属。`
    } else if (value === 'Delete workspace') next = 'Archive workspace'
    else if (value === 'Deleting workspace…') next = 'Archiving workspace…'
    else if (value.startsWith('This removes “') && value.endsWith(' from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.')) {
      const name = value.slice(14, value.indexOf('”'))
      next = `This moves “${name}” and all of its chats to Archived chats while preserving their workspace relationship.`
    }
    if (next === value) return
    if (!originals.has(node)) originals.set(node, value)
    node.nodeValue = next
  }
  const scan = (root) => {
    if (root.nodeType === Node.TEXT_NODE) return replaceText(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) replaceText(node)
  }
  const cleanup = installSettingsRootObserver({
    scan,
    characterData: true,
    onMutation(records) {
      for (const record of records) {
        if (record.type === 'characterData') replaceText(record.target)
        for (const node of record.addedNodes) scan(node)
      }
    },
  })
  return () => {
    cleanup()
    for (const [node, value] of originals) if (node.isConnected) node.nodeValue = value
  }
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

function projectName(workspace) {
  return typeof workspace?.title === 'string' && workspace.title.length > 0
    ? workspace.title
    : '无项目'
}

function ArchiveButton({ wide }) {
  const revision = React.useSyncExternalStore(UI.subscribe, UI.snapshot, UI.snapshot)
  void revision
  return React.createElement('div', { className: 'dam-footer' },
    React.createElement('button', {
      type: 'button',
      className: 'dam-footer-button',
      title: '已归档的聊天',
      'aria-label': '已归档的聊天',
      'aria-pressed': UI.open,
      onClick: () => UI.setOpen(!UI.open),
    },
    React.createElement(IconArchiveOutline20, { size: wide ? 17 : 19 }),
    wide ? React.createElement('span', { className: 'dam-footer-label' }, '已归档的聊天') : null))
}

function ArchiveSection({ useSessions, useWorkspaces, invoke, refresh, pickDirectory }) {
  const sessionState = useSessions((state) => state)
  const workspaceState = useWorkspaces((state) => state)
  const [query, setQuery] = React.useState('')
  const [chatSort, setChatSort] = React.useState('updated')
  const [projectFilter, setProjectFilter] = React.useState('all')
  const [busyId, setBusyId] = React.useState(null)
  const [confirm, setConfirm] = React.useState(null)
  const [groupMenuId, setGroupMenuId] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [notice, setNotice] = React.useState(null)
  const [liveIds, setLiveIds] = React.useState(() => new Set())
  const [archiveState, setArchiveState] = React.useState(() => ({ archivedSessionIds: [], archivedWorkspaces: [] }))

  const refreshArchives = React.useCallback(async () => {
    try {
      const answer = await invoke('archives', {})
      setArchiveState(answer ?? { archivedSessionIds: [], archivedWorkspaces: [] })
    } catch (loadError) {
      setError(errorText(loadError))
    }
  }, [invoke])

  React.useEffect(() => {
    refreshArchives()
  }, [refreshArchives])

  React.useEffect(() => {
    let cancelled = false
    const loadLive = async () => {
      try {
        const answer = await invoke('live', {})
        if (cancelled) return
        setLiveIds(new Set((answer?.liveSessionIds ?? []).map(String)))
      } catch {
        if (!cancelled) setLiveIds(new Set())
      }
    }
    loadLive()
    const timer = window.setInterval(loadLive, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [invoke])

  React.useEffect(() => {
    if (groupMenuId === null) return undefined
    const closeMenu = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.dam-section-menu-wrap') !== null) return
      setGroupMenuId(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [groupMenuId])

  const snapshots = React.useMemo(() => archiveState.archivedWorkspaces ?? [], [archiveState.archivedWorkspaces])
  const snapshotBySession = React.useMemo(() => {
    const map = new Map()
    for (const snapshot of snapshots) {
      for (const sessionId of snapshot.sessionIds ?? []) map.set(String(sessionId), snapshot)
    }
    return map
  }, [snapshots])
  const projects = React.useMemo(() => [...workspaceState.items.map((workspace) => ({
    id: String(workspace.workspaceId),
    title: projectName(workspace),
  })), ...snapshots.map((snapshot) => ({
    id: String(snapshot.workspaceId),
    title: projectName(snapshot),
  })).filter((snapshot) => !workspaceState.items.some((workspace) => String(workspace.workspaceId) === snapshot.id))], [snapshots, workspaceState.items])
  const projectBySession = React.useMemo(() => {
    const map = new Map()
    for (const [sessionId, snapshot] of snapshotBySession) map.set(sessionId, snapshot)
    for (const workspace of workspaceState.items) {
      for (const sessionId of workspace.sessionIds ?? []) if (!map.has(String(sessionId))) map.set(String(sessionId), workspace)
    }
    return map
  }, [snapshotBySession, workspaceState.items])
  const archivedIds = archiveState.archivedSessionIds?.length > 0 ? archiveState.archivedSessionIds : workspaceState.archivedSessionIds
  const archived = React.useMemo(() => new Set(archivedIds), [archivedIds])
  const rows = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return archivedIds.map((id) => {
      const key = String(id)
      const summary = sessionState.byId[key]
      const workspace = projectBySession.get(key)
      return {
        id: key,
        title: summary?.displayTitle || summary?.title || key,
        updatedAt: summary?.updatedAt ?? 0,
        createdAt: summary?.createdAt ?? summary?.updatedAt ?? 0,
        workspace,
        projectId: workspace === undefined ? 'none' : String(workspace.workspaceId),
        projectTitle: projectName(workspace),
        workspaceMissing: workspace?.pathAvailable === false,
        workspaceArchived: typeof workspace?.archivedAt === 'string',
        running: summary?.running === true && liveIds.has(key),
        attached: liveIds.has(key),
        searchable: [summary?.displayTitle, summary?.title, summary?.cwd, key, projectName(workspace)]
          .filter((part) => typeof part === 'string').join(' ').toLocaleLowerCase(),
      }
    }).filter((row) => {
      if (needle.length > 0 && !row.searchable.includes(needle)) return false
      if (projectFilter !== 'all' && row.projectId !== projectFilter) return false
      return true
    }).sort((left, right) => {
      if (chatSort === 'created') return right.createdAt - left.createdAt || right.updatedAt - left.updatedAt
      if (chatSort === 'alpha') return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' }) || right.updatedAt - left.updatedAt
      return right.updatedAt - left.updatedAt
    })
  }, [archivedIds, chatSort, liveIds, projectBySession, projectFilter, query, sessionState.byId])

  const groups = React.useMemo(() => {
    const result = new Map()
    for (const row of rows) {
      const key = row.projectId
      const group = result.get(key) ?? { id: key, title: row.projectTitle, missing: row.workspaceMissing, archivedWorkspace: row.workspaceArchived, rows: [] }
      group.rows.push(row)
      result.set(key, group)
    }
    return [...result.values()]
  }, [rows])

  const runAction = async (method, args, id = null) => {
    setBusyId(id ?? 'all')
    setError(null)
    try {
      const answer = await invoke(method, args)
      if (method === 'restoreWorkspaceAt' && answer.workspaceRelocated) {
        setNotice('工作区目录已变化。如果原目录中的数据已经丢失，原对话可能无法正常继续。')
      }
      if (answer.workspaceMissing) {
        setError(`原工作区路径不存在：${answer.workspacePath}。该项目及会话会继续保留在归档中。`)
      }
      if (answer.skipped?.length > 0) {
        setError(answer.skipped.map((item) => `${item.sessionId}: ${item.message}`).join('；'))
      }
      await refresh()
      await refreshArchives()
      try {
        const answer = await invoke('live', {})
        setLiveIds(new Set((answer?.liveSessionIds ?? []).map(String)))
      } catch {
        setLiveIds(new Set())
      }
      setConfirm(null)
    } catch (actionError) {
      setError(errorText(actionError))
    } finally {
      setBusyId(null)
    }
  }

  React.useEffect(() => {
    if (notice === null) return undefined
    const timer = window.setTimeout(() => setNotice(null), 9000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const askDelete = (row) => setConfirm({
    kind: 'one',
    ids: [row.id],
    title: '永久删除聊天？',
    copy: row.running
      ? '这个聊天仍有运行标记。删除前会强制截断当前回合并释放它，然后永久删除会话文件。'
      : row.attached
        ? '这个聊天仍挂在当前进程里。删除前会强制释放它，再永久删除会话文件。'
        : '这会删除会话日志文件，删除后无法恢复。',
  })
  const askDeleteAll = () => {
    const ids = archivedIds.map(String)
    if (ids.length === 0) return
    setConfirm({
      kind: 'many',
      ids,
      title: '永久删除全部已归档聊天？',
      copy: `将永久删除全部 ${ids.length} 个已归档聊天及其会话日志。此操作无法撤销。`,
    })
  }
  const askDeleteGroup = (group) => setConfirm({
    kind: 'many',
    ids: group.rows.map((row) => row.id),
    title: '删除该项目中的所有聊天？',
    copy: `这将永久删除此项目中的 ${group.rows.length} 条本地已归档聊天`,
  })

  const restoreGroup = async (group) => {
    if (group.missing && typeof pickDirectory === 'function') {
      try {
        const path = await pickDirectory()
        if (path) return runAction('restoreWorkspaceAt', { workspaceId: group.id, path }, group.id)
      } catch (pickError) {
        setError(errorText(pickError))
      }
      return
    }
    return runAction('restoreWorkspace', { workspaceId: group.id }, group.id)
  }

  const toolbar = React.createElement('div', { className: 'dam-toolbar' },
    React.createElement('label', { className: 'dam-search' },
      React.createElement(IconSearchOutline16, { size: 17 }),
      React.createElement('input', {
        value: query,
        placeholder: '搜索已归档聊天',
        'aria-label': '搜索已归档聊天',
        onChange: (event) => setQuery(event.target.value),
      })),
    React.createElement('label', { className: 'dam-filter' },
      React.createElement('select', { value: chatSort, 'aria-label': '聊天排序', onChange: (event) => setChatSort(event.target.value) },
        React.createElement('option', { value: 'updated' }, '更新时间'),
        React.createElement('option', { value: 'created' }, '创建时间'),
        React.createElement('option', { value: 'alpha' }, '按字母顺序')),
      React.createElement(IconChevronDownOutline14, { className: 'dam-filter-chevron', size: 14 })),
    React.createElement('label', { className: 'dam-filter' },
      React.createElement('select', { value: projectFilter, 'aria-label': '项目筛选', onChange: (event) => setProjectFilter(event.target.value) },
        React.createElement('option', { value: 'all' }, '所有项目'),
        React.createElement('option', { value: 'none' }, '无项目'),
        projects.map((project) => React.createElement('option', { key: project.id, value: project.id }, project.title))),
      React.createElement(IconChevronDownOutline14, { className: 'dam-filter-chevron', size: 14 })))

  const renderRow = (row) => React.createElement('article', { key: row.id, className: 'dam-row' },
    React.createElement('div', { className: 'dam-row-copy' },
      React.createElement('div', { className: 'dam-row-title', title: row.title }, row.title),
      React.createElement('div', { className: 'dam-row-meta' },
        React.createElement('span', null, formatDate(row.updatedAt)),
        row.running ? React.createElement('span', null, '正在运行') : row.attached ? React.createElement('span', null, '仍挂载') : null)),
    React.createElement('div', { className: 'dam-row-actions' },
      React.createElement('button', {
        type: 'button',
        className: 'dam-action dam-row-delete',
        title: '永久删除',
        'aria-label': `永久删除 ${row.title}`,
        disabled: busyId !== null,
        onClick: () => askDelete(row),
      }, React.createElement(IconTrashOutline16, { size: 16 })),
      React.createElement('button', {
        type: 'button',
        className: 'dam-action',
        disabled: busyId !== null,
        onClick: () => runAction('unarchive', { sessionId: row.id }, row.id),
      }, '取消归档')))

  const renderGroup = (group) => React.createElement('section', { key: group.id, className: group.missing ? 'dam-section dam-section-missing' : 'dam-section' },
    React.createElement('h2', { className: 'dam-section-heading' },
      React.createElement('span', { className: 'dam-section-heading-title' },
        React.createElement(IconFolderOpen16, { size: 16 }),
        React.createElement('span', { className: 'dam-section-heading-label' }, group.title),
        group.missing ? React.createElement('span', { className: 'dam-section-status' }, '路径不存在') : null),
      React.createElement('span', { className: 'dam-section-heading-actions' },
        React.createElement('span', { className: 'dam-section-count' }, `${group.rows.length} 个聊天`),
        React.createElement('span', { className: 'dam-section-menu-wrap' },
          React.createElement('button', {
            type: 'button',
            className: 'dam-section-more',
            title: `项目操作：${group.title}`,
            'aria-label': `项目操作：${group.title}`,
            'aria-haspopup': 'menu',
            'aria-expanded': groupMenuId === group.id,
            disabled: busyId !== null,
            onClick: () => setGroupMenuId(groupMenuId === group.id ? null : group.id),
          }, React.createElement('span', { className: 'dam-section-more-glyph', 'aria-hidden': 'true' }, '…')),
          groupMenuId === group.id
            ? React.createElement('div', { className: 'dam-group-menu', role: 'menu' },
                group.archivedWorkspace
                  ? React.createElement('button', {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setGroupMenuId(null)
                      restoreGroup(group)
                    },
                  }, React.createElement(IconFolderOpenOutline16, { size: 16 }), '恢复项目')
                  : null,
                React.createElement('button', {
                  type: 'button',
                  role: 'menuitem',
                  onClick: () => {
                    setGroupMenuId(null)
                    askDeleteGroup(group)
                  },
                }, React.createElement(IconTrashOutline16, { size: 16 }), '删除项目中的全部内容'))
            : null))),
    React.createElement('div', { className: 'dam-group' }, group.rows.map(renderRow)))

  const content = rows.length === 0
    ? React.createElement('div', { className: 'dam-empty' }, archived.size === 0 ? '没有已归档的聊天' : '没有符合筛选条件的聊天')
    : React.createElement(React.Fragment, null, groups.map(renderGroup))

  const deleteAll = React.createElement('button', {
    type: 'button',
    className: 'dam-delete-all',
    title: '永久删除全部已归档聊天',
    'aria-label': '永久删除全部已归档聊天',
    disabled: archivedIds.length === 0 || busyId !== null,
    onClick: askDeleteAll,
  }, React.createElement(IconTrashOutline16, { size: 15 }), '全部删除')

  const confirmDialog = confirm === null ? null : React.createElement('div', { className: 'dam-confirm-backdrop', role: 'presentation' },
    React.createElement('div', { className: 'dam-confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dam-confirm-title' },
      React.createElement('h2', { className: 'dam-confirm-title', id: 'dam-confirm-title' }, confirm.title),
      React.createElement('p', { className: 'dam-confirm-copy' }, confirm.copy),
      React.createElement('div', { className: 'dam-confirm-actions' },
        React.createElement('button', { type: 'button', className: 'dam-action', onClick: () => setConfirm(null) }, '取消'),
        React.createElement('button', {
          type: 'button',
          className: 'dam-action dam-action-danger',
          disabled: busyId !== null,
          onClick: () => runAction(confirm.kind === 'many' ? 'deleteMany' : 'delete', confirm.kind === 'many' ? { sessionIds: confirm.ids } : { sessionId: confirm.ids[0] }, confirm.kind === 'many' ? 'all' : confirm.ids[0]),
        }, React.createElement(IconTrashOutline16, { size: 16 }), confirm.kind === 'many' ? '删除' : '永久删除'))))

  return React.createElement(React.Fragment, null,
    notice === null ? null : React.createElement('div', { className: 'dam-toast', role: 'status' },
      React.createElement('span', null, notice),
      React.createElement('button', { type: 'button', onClick: () => setNotice(null) }, '关闭')),
    React.createElement('section', { className: 'dam-settings-page', 'aria-label': '已归档聊天' },
      React.createElement('main', { className: 'dam-main' },
        React.createElement('div', { className: 'dam-main-inner' },
          React.createElement('header', { className: 'dam-header' },
            React.createElement('h2', { className: 'dam-title' }, '已归档聊天'),
            deleteAll),
          error === null ? null : React.createElement('div', { className: 'dam-error', role: 'alert' },
            React.createElement('span', null, error),
            React.createElement('button', { type: 'button', onClick: () => setError(null) }, '关闭')),
          toolbar,
          React.createElement('div', { className: busyId !== null ? 'dam-loading' : undefined }, content)))),
    confirmDialog)
}

export const inject = ['remote', 'connection', 'slots', 'sessions', 'workspaces']

export async function apply(ctx) {
  installStyles()
  ctx.effect(() => installArchiveNavIcon(), 'dsh-archive-manager: settings archive icon')
  ctx.effect(() => installWorkspaceArchiveCopy(), 'dsh-archive-manager: workspace archive copy')
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => disposeRemote, 'dsh-archive-manager: remote contribution')

  const invoke = async (method, args) => {
    const answer = await ctx.connection.rpc.call('/api', `archiveManager/${method}`, { args: { request: args } })
    if (!answer.ok) throw new Error(`${method} failed: ${answer.error.code}: ${answer.error.message}`)
    return answer.value
  }

  const refresh = async () => {
    await ctx.sessions.refresh()
    await ctx.workspaces.refresh()
  }

  const originalDeleteWorkspace = ctx.workspaces.delete
  const originalArchiveSession = ctx.workspaces.archiveSession
  const archiveWorkspace = async (workspaceId) => {
    await invoke('archiveWorkspace', { workspaceId: String(workspaceId) })
    try {
      await originalDeleteWorkspace.call(ctx.workspaces, workspaceId)
    } catch (deleteError) {
      try {
        await invoke('restoreWorkspace', { workspaceId: String(workspaceId) })
        await ctx.workspaces.refresh()
      } catch (rollbackError) {
        console.error('dsh-archive-manager: workspace archive rollback failed', rollbackError)
      }
      throw deleteError
    }
  }
  const archiveSession = async (sessionId) => {
    await invoke('archiveSession', { sessionId: String(sessionId) })
    await ctx.workspaces.refresh()
  }
  ctx.workspaces.delete = archiveWorkspace
  ctx.workspaces.archiveSession = archiveSession
  ctx.effect(() => () => {
    if (ctx.workspaces.delete === archiveWorkspace) ctx.workspaces.delete = originalDeleteWorkspace
    if (ctx.workspaces.archiveSession === archiveSession) ctx.workspaces.archiveSession = originalArchiveSession
  }, 'dsh-archive-manager: workspace archive interception')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archived-conversations',
    order: 21,
    label: '已归档聊天',
    inject: () => ({ invoke, refresh, pickDirectory: () => ctx.workspaces.pickDirectory() }),
    }, ArchiveSection))
}
