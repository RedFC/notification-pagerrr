import type { PagerApi } from './index'

declare global {
  interface Window {
    pager: PagerApi
  }
}

export {}
