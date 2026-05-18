/**
 * LibraryHouse - 图书馆主组件
 *
 * 三层视图架构:
 *   Layer 1: 智能首页 (LibraryHome) - 搜索、分类浏览、统计、Librarian
 *   Layer 2: 分类列表 (LibrarySidebar 实体列表 + 批量操作)
 *   Layer 3: 实体详情 (LibraryContent WSJ Style)
 */

import { useStore } from '@/store'
import { useLibraryData } from './library/useLibraryData'
import { LibrarySidebar } from './library/LibrarySidebar'
import { LibraryContent } from './library/LibraryContent'
import { LibraryHome } from './library/LibraryHome'
import { StudyRoomView } from './studyRoom/StudyRoomView'
import { HouseTabSwitcher } from './HouseTabSwitcher'

export function LibraryHouse() {
  // 根据顶部胶囊 (HouseTabSwitcher) 切换的 libraryTab 决定渲染哪个房间
  // 'library'  -> 原有的知识图书馆三层视图
  // 'studyroom' -> 自习室 (StudyRoomView 自己负责空态/工作区路由)
  const libraryTab = useStore((s) => s.libraryTab)

  if (libraryTab === 'studyroom') {
    return <StudyRoomView />
  }

  return <LibraryHouseInner />
}

function LibraryHouseInner() {
  const data = useLibraryData()
  const isHome = data.view.type === 'home'
  const categories = data.stats?.categories.map(c => c.name) || []

  return (
    <div className="flex h-full flex-col bg-[#fafaf8]">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-amber-100/60 bg-gradient-to-r from-amber-50/40 via-white/90 to-stone-50/60 px-5 py-3 shadow-[0_1px_0_rgba(120,53,15,0.03)] backdrop-blur-sm">
        <HouseTabSwitcher size="compact" />
      </div>

      <div className="flex min-h-0 flex-1">
        <LibrarySidebar
          view={data.view}
          entities={data.entities}
          totalCount={data.totalCount}
          onSelectEntity={data.goEntity}
          searchQuery={data.searchQuery}
          onSearchChange={data.setSearchQuery}
          onImport={data.handleImport}
          importing={data.importing}
          importProgress={data.importProgress}
          onRefresh={data.refresh}
          loading={data.loading}
          onGoHome={data.goHome}
          onGoCategory={data.goCategory}
          selectedIds={data.selectedIds}
          onToggleSelect={data.toggleSelect}
          onSelectAll={data.selectAll}
          onClearSelection={data.clearSelection}
          onBatchAction={data.batchAction}
          onDeleteEntity={data.deleteEntity}
          categories={categories}
        />
        {isHome ? (
          <LibraryHome
            stats={data.stats}
            statsLoading={data.statsLoading}
            searchQuery={data.searchQuery}
            onSearchChange={data.setSearchQuery}
            searchResults={data.searchResults}
            searchLoading={data.searchLoading}
            onSelectEntity={data.goEntity}
            onSelectCategory={data.goCategory}
            librarianContext={data.librarianContext}
            librarianLoading={data.librarianLoading}
            onStartLibrarian={data.startLibrarian}
            onExecuteLibrarian={data.executeLibrarianActions}
          />
        ) : (
          <LibraryContent
            entity={data.entityDetail}
            loading={data.detailLoading}
            onSelectEntity={data.goEntity}
            onDeleteEntity={data.deleteEntity}
          />
        )}
      </div>
    </div>
  )
}
