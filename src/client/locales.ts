/** Locale namespace for the git branch composer selector. */
export const NS = 'gitBranch'

const keys = [
  'trigger.aria', 'trigger.fallback',
  'menu.aria',
  'search.placeholder', 'search.clear',
  'status.loading', 'status.empty', 'status.noMatches', 'status.error', 'retry',
  'current', 'detached',
  'switch.failed',
  'create.button', 'create.title', 'create.description', 'create.placeholder',
  'create.confirm', 'create.cancel', 'create.error.invalid', 'create.failed',
] as const

export type GitBranchKey = typeof keys[number]

export const en: Record<GitBranchKey, string> = {
  'trigger.aria': 'Git branch: {branch}',
  'trigger.fallback': 'HEAD',
  'menu.aria': 'Git branches',
  'search.placeholder': 'Search branches',
  'search.clear': 'Clear search',
  'status.loading': 'Loading branches…',
  'status.empty': 'No branches.',
  'status.noMatches': 'No branches match the search.',
  'status.error': 'Failed to load branches.',
  'retry': 'Retry',
  'current': 'Current branch',
  'detached': 'detached HEAD',
  'switch.failed': 'Could not switch to “{branch}”: {message}',
  'create.button': 'New branch',
  'create.title': 'Create branch',
  'create.description': 'Create a new branch from {branch} and switch to it.',
  'create.placeholder': 'Branch name',
  'create.confirm': 'Create',
  'create.cancel': 'Cancel',
  'create.error.invalid': 'Invalid branch name.',
  'create.failed': 'Could not create branch “{branch}”: {message}',
}

export const zh: Record<GitBranchKey, string> = {
  'trigger.aria': 'Git 分支：{branch}',
  'trigger.fallback': 'HEAD',
  'menu.aria': 'Git 分支',
  'search.placeholder': '搜索分支',
  'search.clear': '清除搜索',
  'status.loading': '正在加载分支…',
  'status.empty': '没有分支。',
  'status.noMatches': '没有匹配搜索的分支。',
  'status.error': '分支加载失败。',
  'retry': '重试',
  'current': '当前分支',
  'detached': '分离 HEAD',
  'switch.failed': '无法切换到分支“{branch}”：{message}',
  'create.button': '新建分支',
  'create.title': '创建分支',
  'create.description': '从当前分支 {branch} 创建新分支并切换到新分支。',
  'create.placeholder': '分支名称',
  'create.confirm': '创建',
  'create.cancel': '取消',
  'create.error.invalid': '分支名称无效。',
  'create.failed': '无法创建分支“{branch}”：{message}',
}
