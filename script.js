document.addEventListener('DOMContentLoaded', () => {
    // --- Supabase 설정 ---
    const { createClient } = window.supabase;
    const supabase = createClient(
        'https://kljhhpciqpyqeaipqiud.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsamhocGNpcXB5cWVhaXBxaXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM3MDcyMzEsImV4cCI6MjA2OTI4MzIzMX0.0KxFpDqYqPBZ1af4xLx6g8haUxm6_O7X7iakOxbLBtI'
    );

    // --- 전역 변수 및 상태 ---
    let currentUser = null;
    let currentRole = null;
    let isSuperUser = false;
    let autoRefreshInterval = null;
    let dispatchChannel = null;

    // --- DOM 요소 ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const mainApp = document.getElementById('main-app');
    const mainNav = document.getElementById('main-nav').querySelector('div');
    const contentArea = document.getElementById('content-area');
    const userInfo = document.getElementById('user-info');
    const logoutButton = document.getElementById('logout-button');
    const modalContainer = document.getElementById('modal-container');

    // --- 초기화 ---
    checkUserSession();
    logoutButton.addEventListener('click', handleLogout);

    // --- 인증 및 권한 설정 ---
    async function checkUserSession() {
        showLoader(true);
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
            window.location.href = 'login.html';
            return;
        }

        currentUser = session.user;
        currentRole = currentUser.user_metadata.role || 'requester';
        isSuperUser = currentUser.email === 'eowert72@gmail.com';

        if (!currentUser.user_metadata.is_approved && !isSuperUser) {
            showMessageModal(
                '계정이 아직 승인되지 않았습니다. 관리자에게 문의하세요.',
                'error',
                handleLogout
            );
            showLoader(false);
            return;
        }

        mainApp.classList.remove('hidden');
        setupUIForRole();
        initializeRealtimeAndRefresh();
        showLoader(false);
    }

    async function handleLogout() {
        showLoader(true);
        if (dispatchChannel) {
            supabase.removeChannel(dispatchChannel);
            dispatchChannel = null;
        }
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    }

    function setupUIForRole() {
        const roleKorean = { requester: '배차 요청자', processor: '배차 진행자', admin: '관리자' };
        const displayName = currentUser.user_metadata.name || currentUser.user_metadata.username || currentUser.email;
        userInfo.innerHTML = `
            <div class="font-semibold text-gray-800">${displayName}</div>
            <div class="text-gray-500 text-xs">${isSuperUser ? '슈퍼유저' : roleKorean[currentRole]}</div>`;

        mainNav.innerHTML = '';

        const allMenus = {
            'dispatch-status': { title: '배차 현황', render: renderDispatchStatus },
            'favorite-destinations': { title: '즐겨찾기 관리', render: renderFavoriteDestinations },
            'destination-master': { title: '납품처 관리', render: () => renderMasterManagement('destinations', '납품처') },
            'loading-point-master': { title: '상차지 관리', render: () => renderMasterManagement('loading_points', '상차지') },
            'unloading-point-master': { title: '하차지 관리', render: () => renderMasterManagement('unloading_points', '하차지') },
            'vehicle-type-master': { title: '차종 관리', render: () => renderMasterManagement('vehicle_types', '차종') },
            'account-management': { title: '계정 관리', render: renderUserManagement }
        };

        const menuOrder = ['dispatch-status', 'favorite-destinations', 'destination-master', 'loading-point-master', 'unloading-point-master', 'vehicle-type-master', 'account-management'];

        menuOrder.forEach(id => {
            const menu = allMenus[id];
            const isAdminOrSuperUser = isSuperUser || currentRole === 'admin';

            let showMenu = false;
            if (id === 'dispatch-status') {
                showMenu = true;
            } else if (id === 'favorite-destinations') {
                showMenu = isAdminOrSuperUser || currentRole === 'requester';
            } else if (id.includes('-master')) {
                showMenu = isSuperUser || currentRole === 'requester';
            } else if (id === 'account-management') {
                showMenu = isAdminOrSuperUser;
            }

            if (!showMenu) {
                return;
            }

            const button = document.createElement('button');
            button.id = `nav-${id}`;
            button.className = 'p-4 text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium';
            button.textContent = menu.title;
            button.onclick = () => {
                document.querySelectorAll('#main-nav button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                menu.render();
            };
            mainNav.appendChild(button);
        });

        if (mainNav.firstChild) {
            mainNav.firstChild.click();
        }
    }

    // --- 공통 유틸리티 ---
    function showLoader(show) {
        loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    function showMessageModal(message, type = 'info', onOk = null) {
        const modalHtml = `
        <div id="message-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[1000]">
            <div class="modal-container bg-white w-full max-w-md rounded-xl shadow-2xl text-center p-6">
                <p class="text-lg mb-4">${message}</p>
                <button id="message-ok-btn" class="btn btn-primary">확인</button>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const closeModal = () => {
            document.getElementById('message-modal')?.remove();
        };

        document.getElementById('message-ok-btn').onclick = () => {
            closeModal();
            if (onOk) {
                onOk();
            }
        };
    }

    function showConfirmationModal(message, onConfirm) {
        const modalHtml = `
        <div id="confirmation-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[1000]">
            <div class="modal-container bg-white w-full max-w-md rounded-xl shadow-2xl">
                <div class="p-6 text-center">
                    <svg aria-hidden="true" class="mx-auto mb-4 w-14 h-14 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <h3 class="mb-5 text-lg font-normal text-gray-500">${message}</h3>
                    <button id="confirm-yes-btn" class="btn btn-accent">네, 진행합니다</button>
                    <button id="confirm-no-btn" class="btn btn-secondary ml-2">아니요, 취소합니다</button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const confirmYesBtn = document.getElementById('confirm-yes-btn');
        const confirmNoBtn = document.getElementById('confirm-no-btn');

        const keydownHandler = (e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                confirmYesBtn.click();
            } else if (e.code === 'Escape') {
                e.preventDefault();
                confirmNoBtn.click();
            }
        };

        const closeModal = () => {
            document.removeEventListener('keydown', keydownHandler);
            document.getElementById('confirmation-modal')?.remove();
        };

        confirmYesBtn.onclick = () => {
            closeModal();
            onConfirm();
        };
        confirmNoBtn.onclick = closeModal;

        document.addEventListener('keydown', keydownHandler);
        confirmYesBtn.focus();
    }

    function getStatusBadge(req) {
        const baseStyle = "text-xs font-semibold me-2 px-3 py-1 rounded-full";
        if (req.status === 'completed') {
            return `<span class="${baseStyle} bg-green-100 text-green-800">완료</span>`;
        }
        if (req.status === 'confirmed') {
            if (req.confirmation_updated_at) {
                return `<span class="${baseStyle} bg-purple-100 text-purple-800">확정 수정</span>`;
            }
            return `<span class="${baseStyle} bg-indigo-100 text-indigo-800">확정</span>`;
        }
        if (req.status === 'requested') {
            if (req.request_updated_at) {
                return `<span class="${baseStyle} bg-orange-100 text-orange-800">요청 수정</span>`;
            }
            return `<span class="${baseStyle} bg-yellow-100 text-yellow-800">요청</span>`;
        }
        return `<span class="${baseStyle} bg-gray-100 text-gray-800">${req.status || 'N/A'}</span>`;
    }

    function getTodayString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatTimestamp(ts) {
        if (!ts) return '-';
        const date = new Date(ts);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function formatCurrency(input) {
        let value = input.value.replace(/[^0-9]/g, '');
        if (value) {
            input.value = parseInt(value, 10).toLocaleString('ko-KR');
        } else {
            input.value = '';
        }
    }

    // --- 알림 및 새로고침 기능 ---
    function initializeRealtimeAndRefresh() {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        autoRefreshInterval = setInterval(() => {
            if (document.getElementById('nav-dispatch-status')?.classList.contains('active')) {
                fetchAndRenderDispatches(true);
            }
        }, 180000);

        dispatchChannel = supabase.channel('dispatch_requests_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_requests' }, payload => {
                if (document.getElementById('nav-dispatch-status')?.classList.contains('active')) {
                    fetchAndRenderDispatches(true);
                }
                handleNotification(payload);
            })
            .subscribe();
    }

    function showNotification(title, options) {
        if (Notification.permission === 'granted') {
            new Notification(title, options);
        }
    }

    function handleNotification(payload) {
        const { eventType, new: newRecord, old: oldRecord } = payload;

        if (currentRole === 'requester' && eventType === 'UPDATE') {
            const isJustConfirmed = oldRecord.status !== 'confirmed' && newRecord.status === 'confirmed';
            if (isJustConfirmed && newRecord.requester_id === currentUser.id) {
                const body = `차량번호: ${newRecord.vehicle_number || '미지정'}\n` +
                    `기사님: ${newRecord.driver_name || '미지정'} / ${newRecord.driver_phone || '미지정'}\n` +
                    `실제차종: ${newRecord.actual_vehicle_type || '미지정'}`;
                showNotification('✅ 배차가 확정되었습니다!', { body: body });
            }
        }

        if (currentRole === 'processor' && eventType === 'INSERT') {
            const quantityParts = [];
            if (newRecord.pallet_qty != null) quantityParts.push(`${newRecord.pallet_qty} PLT`);
            if (newRecord.box_qty != null) quantityParts.push(`${newRecord.box_qty} 박스`);
            const quantityText = quantityParts.join(' / ');

            const body = `납품처: ${newRecord.destination}\n` +
                `하차지: ${newRecord.unloading_location}\n` +
                `요청차종: ${newRecord.vehicle_type || ''} ${newRecord.vehicle_type_info || ''}\n` +
                `수량: ${quantityText}`;
            showNotification('🔔 신규 배차 요청이 있습니다!', { body: body });
        }
    }


    // --- 배차 현황 메뉴 ---
    async function renderDispatchStatus() {
        let addDispatchButtonHtml = '';
        if (currentRole !== 'processor') {
            addDispatchButtonHtml = `<button id="add-dispatch-btn" class="btn btn-primary text-sm"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>신규 배차 요청</button>`;
        }

        contentArea.innerHTML = `
            <div class="content-card flex flex-col mt-4" style="max-height: 80vh;">
                <div class="flex-shrink-0">
                    <div class="flex flex-wrap justify-between items-center mb-6 gap-4">
                        <div class="flex items-center gap-4">
                            <h2 class="text-2xl font-bold text-gray-800">배차 현황</h2>
                            ${addDispatchButtonHtml}
                        </div>
                        <div class="flex items-center flex-wrap gap-4 bg-gray-50 p-2 rounded-lg border">
                            <div class="flex items-center gap-2">
                                <input type="date" id="start-date" class="input-field p-2 text-sm w-40">
                                <span class="text-gray-500">~</span>
                                <input type="date" id="end-date" class="input-field p-2 text-sm w-40">
                                <button id="today-btn" class="btn btn-secondary text-xs">금일</button>
                            </div>

                            <div class="flex items-center gap-2">
                                <select id="search-column" class="input-field p-2 text-sm w-40">
                                    <option value="all">전체</option>
                                    <option value="destination">납품처</option>
                                    <option value="unloading_location">하차지</option>
                                    <option value="vehicle_number">차량번호</option>
                                    <option value="driver_info">기사님 정보</option>
                                </select>
                                <input type="text" id="search-keyword" class="input-field p-2 text-sm w-48" placeholder="검색어를 입력하세요">
                            </div>

                            <div class="flex items-center gap-2">
                                <button id="refresh-btn" class="btn btn-secondary text-xs">새로고침</button>
                                <button id="clear-filters-btn" class="btn btn-secondary text-xs">초기화</button>
                                <button id="search-btn" class="btn btn-primary text-sm">조회</button>
                                <button id="excel-btn" class="btn btn-accent text-sm">엑셀</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="overflow-auto flex-grow">
                    <table class="min-w-full bg-white table-compact">
                        <thead class="bg-slate-800 sticky top-0 z-10">
                            <tr>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">상태</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">요청자</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">출고일</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">납품처</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">상차지</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">상차지 담당자</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">상차시간</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">하차지</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">하차지 담당자</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">하차시간</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">수량</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">요청차종</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">실제차종</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">차량번호</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">기사님 정보</th>
                                <th class="p-2 text-center text-xs font-semibold text-white tracking-wider">관리</th>
                            </tr>
                        </thead>
                        <tbody id="dispatch-list" class="divide-y divide-slate-200"></tbody>
                    </table>
                </div>
            </div>`;
        
        // --- START: 요청사항 반영 ---
        // 기본값으로 오늘 날짜를 설정합니다.
        const today = getTodayString();
        document.getElementById('start-date').value = today;
        document.getElementById('end-date').value = today;
        // --- END: 요청사항 반영 ---

        document.getElementById('search-btn').onclick = fetchAndRenderDispatches;
        document.getElementById('excel-btn').onclick = downloadExcel;
        document.getElementById('refresh-btn').onclick = fetchAndRenderDispatches;
        document.getElementById('today-btn').onclick = () => {
            const today = getTodayString();
            document.getElementById('start-date').value = today;
            document.getElementById('end-date').value = today;
        };
        document.getElementById('clear-filters-btn').onclick = () => {
            document.getElementById('start-date').value = '';
            document.getElementById('end-date').value = '';
            document.getElementById('search-column').value = 'all';
            document.getElementById('search-keyword').value = '';
            fetchAndRenderDispatches();
        };

        const addDispatchBtn = document.getElementById('add-dispatch-btn');
        if (addDispatchBtn) {
            addDispatchBtn.onclick = () => openDispatchModal();
        }

        document.getElementById('search-keyword').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                fetchAndRenderDispatches();
            }
        });

        await fetchAndRenderDispatches();
    }

    async function fetchAndRenderDispatches(isSilent = false) {
        if (!isSilent) {
            showLoader(true);
            const listEl = document.getElementById('dispatch-list');
            listEl.innerHTML = '<tr><td colspan="16" class="text-center p-6 text-gray-500">데이터를 불러오는 중...</td></tr>';
        }

        const startDate = document.getElementById('start-date')?.value;
        const endDate = document.getElementById('end-date')?.value;
        const searchColumn = document.getElementById('search-column')?.value;
        const searchKeyword = document.getElementById('search-keyword')?.value.trim();

        let query = supabase.from('dispatch_requests').select('*');

        if (startDate) query = query.gte('release_date', startDate);
        if (endDate) query = query.lte('release_date', endDate);

        if (searchKeyword) {
            if (searchColumn === 'all') {
                query = query.or(
                    `destination.ilike.%${searchKeyword}%,` +
                    `unloading_location.ilike.%${searchKeyword}%,` +
                    `vehicle_number.ilike.%${searchKeyword}%,` +
                    `driver_name.ilike.%${searchKeyword}%,` +
                    `driver_phone.ilike.%${searchKeyword}%`
                );
            } else if (searchColumn === 'driver_info') {
                query = query.or(
                    `driver_name.ilike.%${searchKeyword}%,` +
                    `driver_phone.ilike.%${searchKeyword}%`
                );
            } else {
                query = query.ilike(searchColumn, `%${searchKeyword}%`);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        const listEl = document.getElementById('dispatch-list');
        listEl.innerHTML = '';
        if (error) {
            listEl.innerHTML = `<tr><td colspan="16" class="text-center p-6 text-red-500">오류: ${error.message}</td></tr>`;
        } else if (data.length === 0) {
            listEl.innerHTML = `<tr><td colspan="16" class="text-center p-6 text-gray-500">조회된 데이터가 없습니다.</td></tr>`;
        } else {
            data.forEach((req, index) => {
                const tr = document.createElement('tr');
                
                let statusClass = 'hover:bg-gray-50';
                if (req.status === 'requested') {
                    statusClass = 'bg-yellow-50 hover:bg-yellow-100';
                }
                tr.className = `transition-colors fade-in-row ${statusClass}`;
                tr.style.animationDelay = `${index * 50}ms`;

                const vehicleRequest = [req.vehicle_type, req.vehicle_type_info].filter(Boolean).join(' ');
                const actualVehicleInfo = [req.actual_vehicle_type, req.vehicle_info].filter(Boolean).join(' / ');
                const quantityParts = [];
                if (req.pallet_qty != null) quantityParts.push(`${req.pallet_qty} PLT`);
                if (req.box_qty != null) quantityParts.push(`${req.box_qty} 박스`);
                const quantityText = quantityParts.join(' / ');
                const driverInfo = [req.driver_name, req.driver_phone].filter(Boolean).join(' / ');
                const loadingManagerInfo = [req.loading_manager_name, req.loading_manager_phone].filter(Boolean).join(' / ');
                const unloadingManagerInfo = [req.unloading_manager_name, req.unloading_manager_phone].filter(Boolean).join(' / ');
                const canDelete = isSuperUser || (currentRole === 'requester' && req.requester_id === currentUser.id);

                tr.innerHTML = `
                    <td class="p-2 text-xs text-center whitespace-nowrap">${getStatusBadge(req)}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">${req.requester_name || ''}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap font-medium">${req.release_date || ''}</td>
                    <td class="p-2 text-xs text-center">${req.destination || ''}</td>
                    <td class="p-2 text-xs text-center">${req.loading_location || ''}</td>
                    <td class="p-2 text-xs text-center">${loadingManagerInfo || '-'}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">${req.loading_time || '-'}</td>
                    <td class="p-2 text-xs text-center">${req.unloading_location || ''}</td>
                    <td class="p-2 text-xs text-center">${unloadingManagerInfo || '-'}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">${req.unloading_time || ''}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">${quantityText || ''}</td>
                    <td class="p-2 text-xs text-center">${vehicleRequest || ''}</td>
                    <td class="p-2 text-xs text-center">${actualVehicleInfo || '-'}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">${req.vehicle_number || '-'}</td>
                    <td class="p-2 text-xs text-center">${driverInfo || '-'}</td>
                    <td class="p-2 text-xs text-center whitespace-nowrap">
                        <button data-id="${req.id}" class="edit-dispatch-btn btn btn-sm btn-secondary">배차진행/상세</button>
                        ${canDelete ? `<button data-id="${req.id}" class="delete-dispatch-btn btn btn-sm btn-accent mt-1">삭제</button>` : ''}
                    </td>`;
                listEl.appendChild(tr);
            });
        }
        
        if (!isSilent) {
            showLoader(false);
        }
    }

    async function downloadExcel() {
        showLoader(true);
        const startDate = document.getElementById('start-date')?.value;
        const endDate = document.getElementById('end-date')?.value;
        const searchColumn = document.getElementById('search-column')?.value;
        const searchKeyword = document.getElementById('search-keyword')?.value.trim();

        let query = supabase.from('dispatch_requests').select('*');

        if (startDate) query = query.gte('release_date', startDate);
        if (endDate) query = query.lte('release_date', endDate);

        if (searchKeyword) {
            if (searchColumn === 'all') {
                query = query.or(
                    `destination.ilike.%${searchKeyword}%,` +
                    `unloading_location.ilike.%${searchKeyword}%,` +
                    `vehicle_number.ilike.%${searchKeyword}%,` +
                    `driver_name.ilike.%${searchKeyword}%,` +
                    `driver_phone.ilike.%${searchKeyword}%`
                );
            } else if (searchColumn === 'driver_info') {
                query = query.or(
                    `driver_name.ilike.%${searchKeyword}%,` +
                    `driver_phone.ilike.%${searchKeyword}%`
                );
            } else {
                query = query.ilike(searchColumn, `%${searchKeyword}%`);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        showLoader(false);

        if (error) {
            showMessageModal("엑셀 데이터 다운로드 실패: " + error.message, 'error');
            return;
        }
        if (data.length === 0) {
            showMessageModal("다운로드할 데이터가 없습니다.");
            return;
        }
        
        const excelHeaders = [
            '상태', '요청자', '출고일', '납품처', '상차지', '상차지 담당자 정보', '하차지', '하차지 담당자 정보',
            '상차지 도착 요청시간', '하차시간', '파렛트 수량', '박스 수량', '요청차종', 
            '차량번호', '실제 차종', '기사님 정보', '금액', '요청(수정)시간', '확정(수정)시간'
        ];

        const excelData = data.map(req => {
            let statusText = req.status;
            if (req.status === 'completed') statusText = '완료';
            else if (req.status === 'confirmed') statusText = req.confirmation_updated_at ? '확정 수정' : '확정';
            else if (req.status === 'requested') statusText = req.request_updated_at ? '요청 수정' : '요청';

            const loadingManagerInfo = [req.loading_manager_name, req.loading_manager_phone].filter(Boolean).join(' / ');
            const unloadingManagerInfo = [req.unloading_manager_name, req.unloading_manager_phone].filter(Boolean).join(' / ');
            
            return [
                statusText,
                req.requester_name || '',
                req.release_date || '',
                req.destination || '',
                req.loading_location || '',
                loadingManagerInfo,
                req.unloading_location || '',
                unloadingManagerInfo,
                req.loading_time || '',
                req.unloading_time || '',
                req.pallet_qty ?? '',
                req.box_qty ?? '',
                [req.vehicle_type, req.vehicle_type_info].filter(Boolean).join(' ') || '',
                req.vehicle_number || '',
                req.actual_vehicle_type || '',
                [req.driver_name, req.driver_phone].filter(Boolean).join(' / ') || '',
                req.cost ?? '',
                formatTimestamp(req.request_updated_at || req.requested_at),
                formatTimestamp(req.confirmation_updated_at || req.confirmed_at),
            ];
        });

        const dataForSheet = [excelHeaders, ...excelData];

        const worksheet = XLSX.utils.aoa_to_sheet(dataForSheet);

        const colWidths = excelHeaders.map((header, i) => {
            const headerLength = header.length;
            const dataLengths = excelData.map(row => (row[i]?.toString() || '').length);
            const maxLength = Math.max(headerLength, ...dataLengths);
            return { wch: maxLength + 2 };
        });
        worksheet['!cols'] = colWidths;

        const headerStyle = {
            font: { bold: true, color: { rgb: "FFFFFFFF" } },
            fill: { fgColor: { rgb: "FF2D3748" } },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
                top: { style: "thin", color: { rgb: "FF000000" } },
                bottom: { style: "thin", color: { rgb: "FF000000" } },
                left: { style: "thin", color: { rgb: "FF000000" } },
                right: { style: "thin", color: { rgb: "FF000000" } }
            }
        };
        const cellStyle = {
            alignment: { horizontal: "center", vertical: "center" },
            border: {
                top: { style: "thin", color: { rgb: "FFCBD5E0" } },
                bottom: { style: "thin", color: { rgb: "FFCBD5E0" } },
                left: { style: "thin", color: { rgb: "FFCBD5E0" } },
                right: { style: "thin", color: { rgb: "FFCBD5E0" } }
            }
        };

        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (!worksheet[cell_ref]) continue;

                if (R === 0) {
                    worksheet[cell_ref].s = headerStyle;
                } else {
                    worksheet[cell_ref].s = cellStyle;
                }
            }
        }

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "배차 현황");
        XLSX.writeFile(workbook, `배차현황_${getTodayString()}.xlsx`);
    }

    // --- 즐겨찾는 납품처 메뉴 ---
    async function renderFavoriteDestinations() {
        contentArea.innerHTML = `
            <div class="content-card mt-4 flex flex-col" style="max-height: 80vh;">
                <div class="flex-shrink-0">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-2xl font-bold">즐겨찾기 관리</h2>
                        <button id="add-favorite-btn" class="btn btn-primary text-sm">신규 즐겨찾기 추가</button>
                    </div>
                </div>
                <div class="overflow-auto flex-grow">
                    <table class="min-w-full bg-white">
                        <thead class="bg-slate-800 sticky top-0 z-10">
                            <tr>
                                <th class="p-4 text-center text-xs font-semibold text-white tracking-wider">납품처</th>
                                <th class="p-4 text-center text-xs font-semibold text-white tracking-wider">상차지</th>
                                <th class="p-4 text-center text-xs font-semibold text-white tracking-wider">하차지</th>
                                <th class="p-4 text-center text-xs font-semibold text-white tracking-wider">관리</th>
                            </tr>
                        </thead>
                        <tbody id="favorites-list" class="divide-y divide-slate-200"></tbody>
                    </table>
                </div>
            </div>`;

        document.getElementById('add-favorite-btn').onclick = openAddFavoriteModal;
        await fetchAndRenderFavorites();
    }

    async function fetchAndRenderFavorites() {
        showLoader(true);
        const listEl = document.getElementById('favorites-list');
        listEl.innerHTML = '<tr><td colspan="4" class="text-center p-6 text-gray-500">데이터를 불러오는 중...</td></tr>';

        const { data, error } = await supabase.from('favorite_destinations').select('*').order('created_at', { ascending: false });

        listEl.innerHTML = '';
        if (error) {
            listEl.innerHTML = `<tr><td colspan="4" class="text-center p-6 text-red-500">오류: ${error.message}</td></tr>`;
        } else if (data.length === 0) {
            listEl.innerHTML = `<tr><td colspan="4" class="text-center p-6 text-gray-500">저장된 즐겨찾기가 없습니다.</td></tr>`;
        } else {
            data.forEach(fav => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition-colors";
                tr.innerHTML = `
                    <td class="p-4 text-center font-medium">${fav.destination}</td>
                    <td class="p-4 text-center text-gray-600">${fav.loading_location}</td>
                    <td class="p-4 text-center text-gray-600">${fav.unloading_location}</td>
                    <td class="p-4 text-center">
                        <button data-id="${fav.id}" class="delete-favorite-btn btn btn-accent text-xs">삭제</button>
                    </td>`;
                listEl.appendChild(tr);
            });
        }
        showLoader(false);
    }

    function openAddFavoriteModal() {
        const modalHtml = `
        <div id="favorite-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-30">
            <div class="modal-container bg-white w-full max-w-lg rounded-xl shadow-2xl">
                <div class="p-6 border-b flex justify-between items-center">
                    <h3 class="text-xl font-bold">신규 즐겨찾기 추가</h3>
                    <button id="close-favorite-modal-btn" class="text-gray-400 hover:text-gray-700 text-3xl">&times;</button>
                </div>
                <form id="favorite-form" class="p-8 space-y-4">
                    <div>
                        <label for="fav-destination" class="block text-sm font-medium text-gray-700">납품처</label>
                        <input type="text" id="fav-destination" name="destination" class="input-field mt-1" required>
                    </div>
                    <div>
                        <label for="fav-loading" class="block text-sm font-medium text-gray-700">상차지</label>
                        <input type="text" id="fav-loading" name="loading_location" class="input-field mt-1" required>
                    </div>
                    <div>
                        <label for="fav-unloading" class="block text-sm font-medium text-gray-700">하차지</label>
                        <input type="text" id="fav-unloading" name="unloading_location" class="input-field mt-1" required>
                    </div>
                    <div class="flex justify-end items-center pt-4 mt-4 border-t gap-3">
                        <button type="button" id="cancel-favorite-btn" class="btn btn-secondary">취소</button>
                        <button type="submit" class="btn btn-primary">저장</button>
                    </div>
                </form>
            </div>
        </div>
        `;
        modalContainer.innerHTML = modalHtml;

        document.getElementById('close-favorite-modal-btn').onclick = closeFavoriteModal;
        document.getElementById('cancel-favorite-btn').onclick = closeFavoriteModal;
        document.getElementById('favorite-form').onsubmit = handleFavoriteFormSubmit;
    }

    function closeFavoriteModal() {
        document.getElementById('favorite-modal')?.remove();
    }

    async function handleFavoriteFormSubmit(e) {
        e.preventDefault();
        showLoader(true);

        const formData = new FormData(e.target);
        const favoriteData = {
            destination: formData.get('destination'),
            loading_location: formData.get('loading_location'),
            unloading_location: formData.get('unloading_location'),
        };

        if (!favoriteData.destination || !favoriteData.loading_location || !favoriteData.unloading_location) {
            showMessageModal('모든 필드를 입력해주세요.');
            showLoader(false);
            return;
        }

        const { error } = await supabase.from('favorite_destinations').insert([favoriteData]);

        showLoader(false);
        if (error) {
            if (error.code === '23505') {
                showMessageModal('이미 등록된 즐겨찾기입니다.', 'error');
            } else {
                showMessageModal('즐겨찾기 추가에 실패했습니다: ' + error.message, 'error');
            }
        } else {
            closeFavoriteModal();
            await fetchAndRenderFavorites();
        }
    }


    // --- 계정 관리 메뉴 ---
    async function renderUserManagement() {
        contentArea.innerHTML = `
            <div class="content-card mt-4">
                <h2 class="text-2xl font-bold mb-4">계정 관리</h2>
                <div class="overflow-x-auto">
                    <table class="min-w-full bg-white">
                        <thead>
                                <tr>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">이름</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">아이디</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">이메일</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">역할</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">상태</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">관리</th>
                                </tr>
                        </thead>
                        <tbody id="user-list" class="divide-y divide-gray-200"></tbody>
                    </table>
                </div>
            </div>`;
        await fetchAndRenderUsers();
    }

    async function fetchAndRenderUsers() {
        showLoader(true);
        const listEl = document.getElementById('user-list');
        listEl.innerHTML = '<tr><td colspan="6" class="text-center p-6 text-gray-500">사용자 목록을 불러오는 중...</td></tr>';

        if (!isSuperUser && currentRole !== 'admin') {
            listEl.innerHTML = '<tr><td colspan="6" class="text-center p-6 text-gray-500">이 메뉴에 접근할 권한이 없습니다.</td></tr>';
            showLoader(false);
            return;
        }

        const { data: users, error: usersError } = await supabase.rpc('list_all_users');
        const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id, username');

        if (usersError || profilesError) {
            const error = usersError || profilesError;
            listEl.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-red-500">오류: ${error.message}</td></tr>`;
            showLoader(false);
            return;
        }

        const profilesMap = new Map(profiles.map(p => [p.id, p]));

        listEl.innerHTML = '';
        if (users.length === 0) {
            listEl.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500">사용자가 없습니다.</td></tr>`;
        } else {
            users.forEach(user => {
                const meta = user.user_metadata || {};
                const profile = profilesMap.get(user.id);

                const username = meta.username || profile?.username || '';

                const isApproved = meta.is_approved === true;
                const isSuperUserAccount = user.email === 'eowert72@gmail.com';

                let roleDisplay = meta.role || '미지정';
                let statusDisplay = isApproved ? '<span class="text-green-600 font-semibold">승인됨</span>' : '<span class="text-yellow-600 font-semibold">승인 대기</span>';
                let actionButton = !isApproved ? `<button data-id="${user.id}" class="approve-btn btn btn-primary text-xs">승인</button>` : '';

                if (isSuperUserAccount) {
                    roleDisplay = '<span class="font-bold text-violet-600">SUPERUSER</span>';
                    statusDisplay = '<span class="text-green-600 font-semibold">자동 승인</span>';
                    actionButton = '';
                }

                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition-colors";
                tr.innerHTML = `
                    <td class="p-4 text-center font-medium">${meta.name || ''}</td>
                    <td class="p-4 text-center text-gray-600">${username}</td>
                    <td class="p-4 text-center text-gray-600">${user.email}</td>
                    <td class="p-4 text-center text-gray-600">${roleDisplay}</td>
                    <td class="p-4 text-center">${statusDisplay}</td>
                    <td class="p-4 text-center">${actionButton}</td>`;
                listEl.appendChild(tr);
            });
        }
        showLoader(false);
    }

    // --- 동적 이벤트 리스너 ---
    contentArea.addEventListener('click', async (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        if (target.classList.contains('edit-dispatch-btn')) {
            const id = target.dataset.id;
            showLoader(true);
            const { data, error } = await supabase.from('dispatch_requests').select('*').eq('id', id).single();
            showLoader(false);
            if (data) openDispatchModal(data);
            else showMessageModal('요청 정보 조회 실패: ' + error.message, 'error');
        }
        if (target.classList.contains('approve-btn')) {
            const userId = target.dataset.id;
            showConfirmationModal('이 사용자를 승인하시겠습니까?', async () => {
                showLoader(true);
                const { error } = await supabase.rpc('approve_user', { user_id_to_approve: userId });
                if (error) {
                    showMessageModal('승인 실패: ' + error.message, 'error');
                } else {
                    showMessageModal('성공적으로 승인되었습니다.', 'success');
                    await fetchAndRenderUsers();
                }
                showLoader(false);
            });
        }
        if (target.classList.contains('delete-favorite-btn')) {
            const id = target.dataset.id;
            showConfirmationModal('이 즐겨찾기를 삭제하시겠습니까?', async () => {
                showLoader(true);
                const { error } = await supabase.from('favorite_destinations').delete().eq('id', id);
                showLoader(false);
                if (error) {
                    showMessageModal('삭제 실패: ' + error.message, 'error');
                } else {
                    await fetchAndRenderFavorites();
                }
            });
        }
        if (target.classList.contains('delete-dispatch-btn')) {
            const id = target.dataset.id;
            showConfirmationModal('이 배차 건을 정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', async () => {
                showLoader(true);
                const { error } = await supabase.from('dispatch_requests').delete().eq('id', id);
                showLoader(false);
                if (error) {
                    showMessageModal('삭제 실패: ' + error.message, 'error');
                } else {
                    await fetchAndRenderDispatches();
                }
            });
        }
        if (target.classList.contains('delete-master-btn')) {
            const id = target.dataset.id;
            const tableName = target.dataset.table;
            const title = target.dataset.title;

            showConfirmationModal('이 항목을 정말로 삭제하시겠습니까?', async () => {
                showLoader(true);
                const { error } = await supabase.from(tableName).delete().eq('id', id);
                if (error) {
                    showMessageModal('삭제 실패: ' + error.message, 'error');
                } else {
                    await fetchAndRenderMasterData(tableName, title);
                }
                showLoader(false);
            });
        }
    });

    // --- 배차 요청 모달 ---
    async function openDispatchModal(request = null) {
        showLoader(true);
        const [destinationsRes, loadingPointsRes, unloadingPointsRes, vehicleTypesRes] = await Promise.all([
            supabase.from('destinations').select('name'),
            supabase.from('loading_points').select('name, address, manager_name, manager_phone'),
            supabase.from('unloading_points').select('name, address, manager_name, manager_phone'),
            supabase.from('vehicle_types').select('name')
        ]);
        showLoader(false);

        const destinations = destinationsRes.data || [];
        const loadingPoints = loadingPointsRes.data || [];
        const unloadingPoints = unloadingPointsRes.data || [];
        const vehicleTypes = vehicleTypesRes.data || [];

        const isConfirmed = !!request?.confirmed_at;
        const canEditRequest = !isConfirmed || isSuperUser || currentRole === 'admin';

        const requesterFieldsDisabled = !canEditRequest || (currentRole === 'processor' && !isSuperUser && currentRole !== 'admin') ? 'disabled' : '';
        const processorFieldsDisabled = (currentRole === 'requester' && !isSuperUser && currentRole !== 'admin') ? 'disabled' : '';

        const vehicleTypeOptions = vehicleTypes.map(vt => `<option value="${vt.name}" ${request?.vehicle_type === vt.name ? 'selected' : ''}>${vt.name}</option>`).join('');
        const actualVehicleTypeOptions = vehicleTypes.map(vt => `<option value="${vt.name}" ${request?.actual_vehicle_type === vt.name ? 'selected' : ''}>${vt.name}</option>`).join('');

        const requestTime = request ? (request.request_updated_at ? formatTimestamp(request.request_updated_at) : formatTimestamp(request.requested_at)) : '';
        const confirmationTime = request ? (request.confirmation_updated_at ? formatTimestamp(request.confirmation_updated_at) : formatTimestamp(request.confirmed_at)) : '';

        modalContainer.innerHTML = `
        <div id="dispatch-modal-inner" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-30">
            <div class="modal-container bg-white w-full max-w-5xl rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto transform scale-95 transition-transform duration-300">
                <div class="sticky top-0 bg-gray-50 p-6 border-b z-10 flex justify-between items-center">
                    <h3 class="text-2xl font-bold">${request ? '배차 진행 / 정보 수정 / 상세 정보' : '신규 배차 요청'}</h3>
                    <button id="close-modal-btn" class="text-gray-400 hover:text-gray-700 text-3xl transition">&times;</button>
                </div>
                <form id="dispatch-form" class="p-8">
                    <input type="hidden" name="id" value="${request?.id || ''}">
                       <div class="mb-4">
                            <button type="button" id="load-favorite-btn" class="btn btn-primary w-full" ${requesterFieldsDisabled}>즐겨찾기 불러오기</button>
                        </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2">
                        <div class="border-b lg:border-b-0 lg:border-r lg:pr-8 py-4">
                            <h4 class="text-lg font-semibold mb-4 text-[var(--primary-color)] flex items-center gap-2">배차 요청 정보</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label class="label">출고 예정일</label><input type="date" name="release_date" class="input-field" value="${request?.release_date || getTodayString()}" ${requesterFieldsDisabled}></div>
                                
                                <div>
                                    <label class="label">납품처</label>
                                    <div class="flex items-center gap-2">
                                        <input type="text" name="destination" id="destination_input" class="input-field" placeholder="납품처 이름" value="${request?.destination || ''}" ${requesterFieldsDisabled}>
                                        <button type="button" id="destination-search-btn" class="btn btn-secondary p-2" ${requesterFieldsDisabled}>
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="md:col-span-2">
                                    <label class="label">상차지</label>
                                    <div class="flex items-center gap-2">
                                        <input type="text" name="loading_location" id="loading_location_input" class="input-field" placeholder="주소를 입력하거나 돋보기를 눌러 검색" value="${request?.loading_location || ''}" ${requesterFieldsDisabled}>
                                        <button type="button" id="loading-search-btn" class="btn btn-secondary p-2" ${requesterFieldsDisabled}>
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                                        </button>
                                    </div>
                                </div>
                                
                                <div><label class="label">상차지 담당자</label><input type="text" name="loading_manager_name" class="input-field" placeholder="담당자 이름" value="${request?.loading_manager_name || ''}" ${requesterFieldsDisabled}></div>
                                <div><label class="label">상차지 연락처</label><input type="text" name="loading_manager_phone" class="input-field" placeholder="담당자 연락처" value="${request?.loading_manager_phone || ''}" ${requesterFieldsDisabled}></div>
                                
                                <div class="md:col-span-2">
                                    <label class="label">상차지 도착 요청 시간</label>
                                    <div class="flex items-center gap-2">
                                        <input type="text" name="loading_time" id="loading_time_input" class="input-field" placeholder="예: 10:00 또는 시간 협의" value="${request?.loading_time || ''}" ${requesterFieldsDisabled}>
                                        <button type="button" id="set-loading-tbd-btn" class="btn btn-secondary text-xs whitespace-nowrap" ${requesterFieldsDisabled}>시간 협의</button>
                                    </div>
                                </div>

                                <div class="md:col-span-2">
                                    <label class="label">하차지</label>
                                    <div class="flex items-center gap-2">
                                        <input type="text" name="unloading_location" id="unloading_location_input" class="input-field" placeholder="주소를 입력하거나 돋보기를 눌러 검색" value="${request?.unloading_location || ''}" ${requesterFieldsDisabled}>
                                        <button type="button" id="unloading-search-btn" class="btn btn-secondary p-2" ${requesterFieldsDisabled}>
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                                        </button>
                                    </div>
                                </div>

                                <div><label class="label">하차지 담당자</label><input type="text" name="unloading_manager_name" class="input-field" placeholder="담당자 이름" value="${request?.unloading_manager_name || ''}" ${requesterFieldsDisabled}></div>
                                <div><label class="label">하차지 연락처</label><input type="text" name="unloading_manager_phone" class="input-field" placeholder="담당자 연락처" value="${request?.unloading_manager_phone || ''}" ${requesterFieldsDisabled}></div>
                                
                                <div class="md:col-span-2">
                                    <label class="label">하차지 도착 요청 시간</label>
                                    <div class="flex items-center gap-2">
                                        <input type="text" name="unloading_time" id="unloading_time_input" class="input-field" placeholder="예: 14:00 또는 도착 즉시" value="${request?.unloading_time || ''}" ${requesterFieldsDisabled}>
                                        <button type="button" id="set-unloading-now-btn" class="btn btn-secondary text-xs whitespace-nowrap" ${requesterFieldsDisabled}>도착 즉시</button>
                                    </div>
                                </div>
                                
                                <div>
                                    <label class="label">요청 차종</label>
                                    <select name="vehicle_type" class="input-field" ${requesterFieldsDisabled}>
                                        <option value="">차종 선택</option>
                                        ${vehicleTypeOptions}
                                    </select>
                                </div>
                                <div><label class="label">요청 차종 추가 정보</label><input type="text" name="vehicle_type_info" class="input-field" placeholder="예: 윙바디, 리프트" value="${request?.vehicle_type_info || ''}" ${requesterFieldsDisabled}></div>
                                <div><label class="label">파렛트 수량</label><input type="number" name="pallet_qty" class="input-field" placeholder="숫자만 입력" value="${request?.pallet_qty ?? ''}" ${requesterFieldsDisabled}></div>
                                <div><label class="label">박스 수량</label><input type="number" name="box_qty" class="input-field" placeholder="숫자만 입력" value="${request?.box_qty ?? ''}" ${requesterFieldsDisabled}></div>
                                <div class="md:col-span-2"><label class="label">요청 특이사항</label><textarea name="request_notes" class="input-field" rows="2" placeholder="예) 상차 도크 번호, 수량 변동 가능성 등 별도 코멘트" ${requesterFieldsDisabled}>${request?.request_notes || ''}</textarea></div>
                                <div class="md:col-span-2 flex items-center mt-2">
                                    <input type="checkbox" id="save-as-favorite" name="save_as_favorite" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${requesterFieldsDisabled}>
                                    <label for="save-as-favorite" class="ml-2 block text-sm text-gray-700">입력한 납품처/상차지/하차지를 즐겨찾기에 추가</label>
                                </div>
                            </div>
                        </div>
                        <div class="py-4">
                            <h4 class="text-lg font-semibold mb-4 text-green-600 flex items-center gap-2">배차 진행 정보</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="label">실제 차종</label>
                                    <select name="actual_vehicle_type" class="input-field" ${processorFieldsDisabled}>
                                        <option value="">차종 선택</option>
                                        ${actualVehicleTypeOptions}
                                    </select>
                                </div>
                                <div><label class="label">차종 추가 정보</label><input type="text" name="vehicle_info" class="input-field" placeholder="예: 윙바디, 카고, 리프트" value="${request?.vehicle_info || ''}" ${processorFieldsDisabled}></div>
                                <div class="md:col-span-2"><label class="label">차량번호</label><input type="text" name="vehicle_number" class="input-field" placeholder="예: 12가 3456" value="${request?.vehicle_number || ''}" ${processorFieldsDisabled}></div>
                                <div><label class="label">기사님 이름</label><input type="text" name="driver_name" class="input-field" placeholder="예: 홍길동" value="${request?.driver_name || ''}" ${processorFieldsDisabled}></div>
                                <div><label class="label">기사님 연락처</label><input type="text" name="driver_phone" class="input-field" placeholder="예: 010-1234-5678" value="${request?.driver_phone || ''}" ${processorFieldsDisabled}></div>
                                <div><label class="label">금액</label><input type="text" name="cost" id="cost_input" class="input-field" placeholder="숫자만 입력" value="${request?.cost ? request.cost.toLocaleString('ko-KR') : ''}" ${processorFieldsDisabled}></div>
                                <div class="md:col-span-2"><label class="label">진행 특이사항</label><textarea name="processing_notes" class="input-field" rows="2" placeholder="예) 운송료 특이사항, 입차 예상시간 등 별도 코멘트" ${processorFieldsDisabled}>${request?.processing_notes || ''}</textarea></div>
                            </div>
                        </div>
                    </div>
                    
                    ${request ? `
                    <div class="mt-6 pt-4 border-t text-sm text-gray-500 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div><strong>요청(수정)시간:</strong> <span class="font-mono">${requestTime || 'N/A'}</span></div>
                        <div><strong>확정(수정)시간:</strong> <span class="font-mono">${confirmationTime || 'N/A'}</span></div>
                    </div>
                    ` : ''}

                    <div class="flex justify-end items-center pt-8 mt-4 border-t gap-3">
                        <button type="button" id="cancel-dispatch-btn" class="btn btn-secondary">취소</button>
                        <button type="submit" class="btn btn-primary">저장</button>
                    </div>
                </form>
            </div>
        </div>`;

        setTimeout(() => {
            document.querySelector('.modal-container')?.classList.remove('scale-95');
        }, 10);

        document.getElementById('close-modal-btn').onclick = closeDispatchModal;
        document.getElementById('cancel-dispatch-btn').onclick = closeDispatchModal;
        document.getElementById('dispatch-form').onsubmit = handleDispatchFormSubmit;

        document.getElementById('load-favorite-btn').onclick = openFavoritesLoader;
        document.getElementById('destination-search-btn').onclick = () => openPointSearchModal('destination', destinations);
        document.getElementById('loading-search-btn').onclick = () => openPointSearchModal('loading', loadingPoints);
        document.getElementById('unloading-search-btn').onclick = () => openPointSearchModal('unloading', unloadingPoints);
        document.getElementById('cost_input').addEventListener('input', (e) => formatCurrency(e.target));
        document.getElementById('set-loading-tbd-btn').onclick = () => {
            document.getElementById('loading_time_input').value = '시간 협의';
        };
        document.getElementById('set-unloading-now-btn').onclick = () => {
            document.getElementById('unloading_time_input').value = '도착 즉시';
        };
    }

    async function openFavoritesLoader() {
        showLoader(true);
        const { data: favorites, error } = await supabase.from('favorite_destinations').select('*');
        showLoader(false);

        if (error) {
            showMessageModal('즐겨찾기 목록을 불러오는 데 실패했습니다: ' + error.message, 'error');
            return;
        }

        const favoritesListHtml = favorites.length > 0 ? favorites.map(fav => `
            <li class="p-3 hover:bg-gray-100 rounded-md cursor-pointer favorite-item" 
                data-destination="${fav.destination || ''}" 
                data-loading="${fav.loading_location || ''}" 
                data-unloading="${fav.unloading_location || ''}">
                <p class="font-semibold">${fav.destination}</p>
                <p class="text-xs text-gray-500">상차: ${fav.loading_location} / 하차: ${fav.unloading_location}</p>
            </li>
        `).join('') : '<li class="p-4 text-center text-gray-500">저장된 즐겨찾기가 없습니다.</li>';

        const loaderModalHtml = `
            <div id="favorites-loader-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-40">
                <div class="modal-container bg-white w-full max-w-lg rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
                    <div class="p-4 border-b flex justify-between items-center">
                        <h4 class="text-lg font-bold">즐겨찾기에서 선택</h4>
                        <button id="close-loader-modal-btn" class="text-2xl">&times;</button>
                    </div>
                    <ul class="p-2 overflow-y-auto">${favoritesListHtml}</ul>
                </div>
            </div>
        `;

        modalContainer.insertAdjacentHTML('beforeend', loaderModalHtml);

        document.getElementById('close-loader-modal-btn').onclick = closeFavoritesLoader;
        document.querySelectorAll('.favorite-item').forEach(item => {
            item.onclick = () => {
                document.querySelector('input[name="destination"]').value = item.dataset.destination;
                document.querySelector('input[name="loading_location"]').value = item.dataset.loading;
                document.querySelector('input[name="unloading_location"]').value = item.dataset.unloading;
                closeFavoritesLoader();
            };
        });
    }

    function closeFavoritesLoader() {
        document.getElementById('favorites-loader-modal')?.remove();
    }


    function openPointSearchModal(type, points) {
        const typeMap = {
            destination: { title: '납품처 검색', hasAddress: false },
            loading: { title: '상차지 검색', hasAddress: true },
            unloading: { title: '하차지 검색', hasAddress: true }
        };
        const config = typeMap[type];

        const modalHtml = `
        <div id="point-search-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-40">
            <div class="modal-container bg-white w-full max-w-2xl rounded-xl shadow-2xl">
                <div class="p-4 border-b flex justify-between items-center">
                    <h3 class="text-xl font-bold">${config.title}</h3>
                    <button id="close-search-modal-btn" class="text-gray-400 hover:text-gray-700 text-3xl">&times;</button>
                </div>
                <div class="p-4">
                    <div class="flex items-center gap-4 mb-4 bg-gray-50 p-2 rounded-lg border">
                        <input type="text" id="search-modal-name" class="input-field text-sm" placeholder="이름 검색">
                        ${config.hasAddress ? '<input type="text" id="search-modal-address" class="input-field text-sm" placeholder="주소 검색">' : ''}
                        <button id="search-modal-btn" class="btn btn-primary text-sm">조회</button>
                    </div>
                    <div class="overflow-auto h-64">
                        <table class="min-w-full bg-white">
                            <thead class="bg-slate-800 sticky top-0 z-10">
                                <tr>
                                    <th class="p-2 text-center text-xs font-semibold text-white">이름</th>
                                    ${config.hasAddress ? '<th class="p-2 text-center text-xs font-semibold text-white">주소</th>' : ''}
                                </tr>
                            </thead>
                            <tbody id="search-results-list"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        `;
        modalContainer.insertAdjacentHTML('beforeend', modalHtml);

        const searchResultsList = document.getElementById('search-results-list');
        const searchModalName = document.getElementById('search-modal-name');
        const searchModalAddress = document.getElementById('search-modal-address');

        const renderResults = (filteredPoints) => {
            searchResultsList.innerHTML = '';
            if (filteredPoints.length === 0) {
                const colspan = config.hasAddress ? 2 : 1;
                searchResultsList.innerHTML = `<tr><td colspan="${colspan}" class="text-center p-4 text-gray-500">검색 결과가 없습니다.</td></tr>`;
                return;
            }
            filteredPoints.forEach(point => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-gray-100 cursor-pointer';
                tr.innerHTML = `
                    <td class="p-2 text-center text-sm">${point.name}</td>
                    ${config.hasAddress ? `<td class="p-2 text-center text-sm">${point.address || ''}</td>` : ''}
                `;
                tr.addEventListener('dblclick', () => {
                    if (type === 'destination') {
                        document.getElementById('destination_input').value = point.name;
                    } else if (type === 'loading') {
                        document.getElementById('loading_location_input').value = point.address;
                        document.querySelector('input[name="loading_manager_name"]').value = point.manager_name || '';
                        document.querySelector('input[name="loading_manager_phone"]').value = point.manager_phone || '';
                    } else if (type === 'unloading') {
                        document.getElementById('unloading_location_input').value = point.address;
                        document.querySelector('input[name="unloading_manager_name"]').value = point.manager_name || '';
                        document.querySelector('input[name="unloading_manager_phone"]').value = point.manager_phone || '';
                    }
                    document.getElementById('point-search-modal').remove();
                });
                searchResultsList.appendChild(tr);
            });
        };

        const performSearch = () => {
            const nameQuery = searchModalName.value.toLowerCase();
            const addressQuery = config.hasAddress ? (searchModalAddress.value || '').toLowerCase() : '';
            const filtered = points.filter(p => {
                const nameMatch = p.name.toLowerCase().includes(nameQuery);
                const addressMatch = config.hasAddress ? (p.address || '').toLowerCase().includes(addressQuery) : true;
                return nameMatch && addressMatch;
            });
            renderResults(filtered);
        };

        document.getElementById('search-modal-btn').onclick = performSearch;
        document.getElementById('close-search-modal-btn').onclick = () => {
            document.getElementById('point-search-modal').remove();
        };

        renderResults(points);
    }

    function closeDispatchModal() {
        const modalEl = document.querySelector('#dispatch-modal-inner');
        if (modalEl) {
            modalEl.classList.add('opacity-0');
            modalEl.querySelector('.modal-container').classList.add('scale-95');
            setTimeout(() => { modalContainer.innerHTML = ''; }, 300);
        }
    }

    async function handleDispatchFormSubmit(e) {
        e.preventDefault();
        showLoader(true);
        const formData = new FormData(e.target);
        const requestData = Object.fromEntries(formData.entries());
        const now = new Date().toISOString();

        const requestId = requestData.id;
        delete requestData.id;

        const saveAsFavorite = !!requestData.save_as_favorite;
        delete requestData.save_as_favorite;

        if (requestData.cost) {
            requestData.cost = requestData.cost.replace(/,/g, '');
        }

        const numericFields = ['pallet_qty', 'box_qty', 'cost'];
        numericFields.forEach(field => {
            requestData[field] = requestData[field] ? parseInt(requestData[field], 10) : null;
        });

        for (const key in requestData) {
            if (requestData[key] === '') requestData[key] = null;
        }

        let result;
        if (requestId) {
            const { data: currentRequest } = await supabase.from('dispatch_requests').select('status, confirmed_at').eq('id', requestId).single();

            if (currentRequest.status === 'requested') {
                requestData.request_updated_at = now;
                if (!currentRequest.confirmed_at && requestData.vehicle_number) {
                    requestData.status = 'confirmed';
                    requestData.confirmed_at = now;
                }
            } else if (currentRequest.status === 'confirmed') {
                requestData.confirmation_updated_at = now;
            }
            result = await supabase.from('dispatch_requests').update(requestData).eq('id', requestId);
        } else {
            requestData.requester_id = currentUser.id;
            requestData.requester_email = currentUser.email;
            requestData.requester_name = currentUser.user_metadata.name || currentUser.user_metadata.username || currentUser.email;
            requestData.status = 'requested';
            requestData.requested_at = now;
            result = await supabase.from('dispatch_requests').insert([requestData]);
        }

        if (saveAsFavorite && !result.error) {
            const favoriteData = {
                destination: requestData.destination,
                loading_location: requestData.loading_location,
                unloading_location: requestData.unloading_location
            };
            if (favoriteData.destination && favoriteData.loading_location && favoriteData.unloading_location) {
                const { error: favError } = await supabase.from('favorite_destinations').insert([favoriteData]);
                if (favError && favError.code !== '23505') {
                    console.warn("즐겨찾기 저장 실패:", favError.message);
                }
            }
        }

        showLoader(false);
        if (result.error) {
            showMessageModal('저장 실패: ' + result.error.message, 'error');
        } else {
            closeDispatchModal();
            await fetchAndRenderDispatches();
        }
    }

    // --- 마스터 관리 ---
    async function renderMasterManagement(tableName, title) {
        const hasAddress = ['loading_points', 'unloading_points'].includes(tableName);
        const nameHeader = {
            'destinations': '납품처',
            'loading_points': '이름',
            'unloading_points': '이름',
            'vehicle_types': '차종'
        }[tableName];

        contentArea.innerHTML = `
            <div class="content-card mt-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold">${title} 관리</h2>
                    <div class="flex items-center gap-2">
                        <button id="download-template-btn" class="btn btn-secondary text-sm">양식 다운로드</button>
                        <label class="btn btn-accent text-sm cursor-pointer">
                            엑셀 업로드
                            <input type="file" id="excel-upload-btn" class="hidden" accept=".xlsx, .xls, .csv">
                        </label>
                        <button id="add-master-btn" class="btn btn-primary text-sm">신규 등록</button>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="min-w-full bg-white">
                        <thead>
                                <tr>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">${nameHeader}</th>
                                    ${hasAddress ? `
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">주소</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">담당자 이름</th>
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">담당자 연락처</th>
                                    ` : ''}
                                    <th class="p-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b-2">관리</th>
                                </tr>
                        </thead>
                        <tbody id="master-list" class="divide-y divide-gray-200"></tbody>
                    </table>
                </div>
            </div>`;

        document.getElementById('add-master-btn').onclick = () => openMasterDataModal(tableName, title);
        document.getElementById('excel-upload-btn').onchange = (e) => handleExcelUpload(e, tableName, title);
        document.getElementById('download-template-btn').onclick = () => downloadMasterTemplate(tableName, title);

        await fetchAndRenderMasterData(tableName, title);
    }

    async function fetchAndRenderMasterData(tableName, title) {
        showLoader(true);
        const listEl = document.getElementById('master-list');
        const hasAddress = ['loading_points', 'unloading_points'].includes(tableName);
        const colspan = hasAddress ? 5 : 2;
        listEl.innerHTML = `<tr><td colspan="${colspan}" class="text-center p-6 text-gray-500">데이터를 불러오는 중...</td></tr>`;

        const { data, error } = await supabase.from(tableName).select('*').order('name', { ascending: true });

        listEl.innerHTML = '';
        if (error) {
            listEl.innerHTML = `<tr><td colspan="${colspan}" class="text-center p-6 text-red-500">오류: ${error.message}</td></tr>`;
        } else if (data.length === 0) {
            listEl.innerHTML = `<tr><td colspan="${colspan}" class="text-center p-6 text-gray-500">데이터가 없습니다.</td></tr>`;
        } else {
            data.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition-colors";
                tr.innerHTML = `
                    <td class="p-4 text-center font-medium">${item.name}</td>
                    ${hasAddress ? `
                    <td class="p-4 text-center text-gray-600">${item.address || ''}</td>
                    <td class="p-4 text-center text-gray-600">${item.manager_name || ''}</td>
                    <td class="p-4 text-center text-gray-600">${item.manager_phone || ''}</td>
                    ` : ''}
                    <td class="p-4 text-center">
                        <button data-id="${item.id}" data-table="${tableName}" data-title="${title}" class="delete-master-btn btn btn-accent text-xs">삭제</button>
                    </td>`;
                listEl.appendChild(tr);
            });
        }
        showLoader(false);
    }

    function openMasterDataModal(tableName, title) {
        const hasAddress = ['loading_points', 'unloading_points'].includes(tableName);
        const nameLabel = {
            'destinations': '납품처명',
            'loading_points': '상차지명',
            'unloading_points': '하차지명',
            'vehicle_types': '차종'
        }[tableName];

        const modalHtml = `
        <div id="master-data-modal" class="modal-overlay fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-30">
            <div class="modal-container bg-white w-full max-w-lg rounded-xl shadow-2xl">
                <div class="p-6 border-b flex justify-between items-center">
                    <h3 class="text-xl font-bold">신규 ${title} 등록</h3>
                    <button id="close-master-modal-btn" class="text-gray-400 hover:text-gray-700 text-3xl">&times;</button>
                </div>
                <form id="master-data-form" class="p-8 space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">${nameLabel}</label>
                        <input type="text" name="name" class="input-field mt-1" required>
                    </div>
                    ${hasAddress ? `
                    <div>
                        <label class="block text-sm font-medium text-gray-700">주소</label>
                        <input type="text" name="address" class="input-field mt-1" required>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">담당자 이름</label>
                        <input type="text" name="manager_name" class="input-field mt-1">
                    </div>
                     <div>
                        <label class="block text-sm font-medium text-gray-700">담당자 연락처</label>
                        <input type="text" name="manager_phone" class="input-field mt-1">
                    </div>
                    ` : ''}
                    <div class="flex justify-end items-center pt-4 mt-4 border-t gap-3">
                        <button type="button" id="cancel-master-btn" class="btn btn-secondary">취소</button>
                        <button type="submit" class="btn btn-primary">저장</button>
                    </div>
                </form>
            </div>
        </div>
        `;
        modalContainer.innerHTML = modalHtml;

        const closeModal = () => document.getElementById('master-data-modal')?.remove();
        document.getElementById('close-master-modal-btn').onclick = closeModal;
        document.getElementById('cancel-master-btn').onclick = closeModal;
        document.getElementById('master-data-form').onsubmit = (e) => handleMasterDataSubmit(e, tableName, title);
    }

    async function handleMasterDataSubmit(e, tableName, title) {
        e.preventDefault();
        showLoader(true);

        const formData = new FormData(e.target);
        const dataToInsert = Object.fromEntries(formData.entries());

        for (const key in dataToInsert) {
            if (dataToInsert[key] === '') dataToInsert[key] = null;
        }

        const { error } = await supabase.from(tableName).insert([dataToInsert]);
        showLoader(false);

        if (error) {
            showMessageModal('등록 실패: ' + error.message, 'error');
        } else {
            document.getElementById('master-data-modal')?.remove();
            showMessageModal('성공적으로 등록되었습니다.', 'success');
            await fetchAndRenderMasterData(tableName, title);
        }
    }

    function downloadMasterTemplate(tableName, title) {
        const hasAddress = ['loading_points', 'unloading_points'].includes(tableName);
        const nameHeader = {
            'destinations': '납품처',
            'loading_points': '이름',
            'unloading_points': '이름',
            'vehicle_types': '차종'
        }[tableName];

        const headers = hasAddress ? [[nameHeader, '주소', '담당자 이름', '담당자 연락처']] : [[nameHeader]];
        const fileName = `${title}_업로드_양식.xlsx`;

        const worksheet = XLSX.utils.aoa_to_sheet(headers);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '양식');
        XLSX.writeFile(workbook, fileName);
    }

    async function handleExcelUpload(e, tableName, title) {
        const file = e.target.files[0];
        if (!file) return;

        showLoader(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                const hasAddress = ['loading_points', 'unloading_points'].includes(tableName);
                const nameHeader = {
                    'destinations': '납품처',
                    'loading_points': '이름',
                    'unloading_points': '이름',
                    'vehicle_types': '차종'
                }[tableName];

                const requiredHeaders = hasAddress ? [nameHeader, '주소', '담당자 이름', '담당자 연락처'] : [nameHeader];
                const headers = json[0];

                if (![nameHeader, ...(hasAddress ? ['주소'] : [])].every(h => headers.includes(h))) {
                    throw new Error(`엑셀 파일의 첫 행에 필수 헤더(${nameHeader}${hasAddress ? ', 주소' : ''})가 필요합니다.`);
                }

                const nameIndex = headers.indexOf(nameHeader);
                const addressIndex = hasAddress ? headers.indexOf('주소') : -1;
                const managerNameIndex = hasAddress ? headers.indexOf('담당자 이름') : -1;
                const managerPhoneIndex = hasAddress ? headers.indexOf('담당자 연락처') : -1;

                const dataToInsert = json.slice(1).map(row => {
                    const item = { name: row[nameIndex] };
                    if (hasAddress) {
                        item.address = row[addressIndex];
                        item.manager_name = managerNameIndex > -1 ? row[managerNameIndex] : null;
                        item.manager_phone = managerPhoneIndex > -1 ? row[managerPhoneIndex] : null;
                    }
                    return item;
                }).filter(item => item.name);

                if (dataToInsert.length === 0) {
                    throw new Error("업로드할 데이터가 없습니다.");
                }

                const { error } = await supabase.from(tableName).insert(dataToInsert, { upsert: true, onConflict: 'name' });
                if (error) throw error;

                showMessageModal('엑셀 데이터가 성공적으로 업로드되었습니다.', 'success');
                await fetchAndRenderMasterData(tableName, title);
            } catch (err) {
                showMessageModal('엑셀 업로드 실패: ' + err.message, 'error');
            } finally {
                showLoader(false);
                e.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    }
});