document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    fetch('/api/me')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                window.location.href = '/index.html';
            } else {
                document.getElementById('userName').textContent = data.fullName;
                loadDashboard();
            }
        })
        .catch(error => {
            window.location.href = '/index.html';
        });

    // Update WITA time every second
    function updateWITATime() {
        const now = new Date();
        const options = {
            timeZone: 'Asia/Makassar',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        const timeString = now.toLocaleTimeString('id-ID', options);
        document.getElementById('witaTime').textContent = timeString;
    }

    updateWITATime();
    setInterval(updateWITATime, 1000);

    // Refresh all data (global function for onclick)
    window.refreshDashboard = function() {
        console.log('Refreshing dashboard...');
        try {
            loadDashboard();
            loadActivePermissions();
            loadRecentLogs();
            loadTeachers();
            loadDevices();
            console.log('Dashboard refreshed');
            alert('Dashboard berhasil di-refresh!');
        } catch (error) {
            console.error('Error refreshing dashboard:', error);
            alert('Gagal refresh dashboard. Error: ' + error.message);
        }
    };

    // Add refresh button click handler
    document.addEventListener('DOMContentLoaded', function() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('Refresh button clicked');
                refreshDashboard();
            });
            console.log('Refresh button event listener attached');
        } else {
            console.log('Refresh button not found');
        }
    });

    // Socket.IO connection
    const socket = io();

    socket.on('mqtt_message', function(data) {
        console.log('MQTT Message:', data);
        if (data.topic === 'izin/rfid') {
            loadDashboard();
            loadActivePermissions();
            loadLogs();
        }
    });

    socket.on('device_status_update', function(data) {
        console.log('Device status update:', data);
        loadDevices();
    });

    // Navigation
    document.querySelectorAll('.nav-link[data-page]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            
            // Update active nav
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            // Show page
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(page + 'Page').classList.add('active');
            
            // Load page data
            if (page === 'dashboard') loadDashboard();
            else if (page === 'teachers') loadTeachers();
            else if (page === 'permissions') loadPermissions();
            else if (page === 'devices') loadDevices();
            else if (page === 'logs') loadLogs();
        });
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', function(e) {
        e.preventDefault();
        fetch('/api/logout', { method: 'POST' })
            .then(() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/index.html';
            });
    });

    // Load Dashboard
    function loadDashboard() {
        fetch('/api/dashboard/stats')
            .then(response => response.json())
            .then(data => {
                document.getElementById('totalTeachers').textContent = data.totalTeachers;
                document.getElementById('todayPermissions').textContent = data.todayPermissions;
                document.getElementById('monthPermissions').textContent = data.monthPermissions;
                document.getElementById('activePermissions').textContent = data.activePermissions;
                
                loadActivePermissions();
                loadRecentLogs();
            })
            .catch(error => console.error('Error loading dashboard:', error));
    }

    function loadActivePermissions() {
        fetch('/api/permissions/active')
            .then(response => response.json())
            .then(data => {
                const tbody = document.getElementById('activePermissionsTable');
                const fullTbody = document.getElementById('activePermissionsFullTable');

                let html = '';
                data.forEach(p => {
                    const durationClass = p.current_duration > 60 ? 'duration-highlight' : 'duration-normal';
                    const statusText = p.status === 'out' ? 'Belum Kembali' : 'Kembali';
                    const statusClass = p.status === 'out' ? 'status-out' : 'status-in';

                    html += `
                        <tr data-check-out-time="${p.check_out_time}" data-status="${p.status}">
                            <td>${p.full_name}</td>
                            <td>${p.employee_type}</td>
                            <td>${formatDateTime(p.check_out_time)}</td>
                            <td class="${durationClass} duration-counter" data-check-out="${p.check_out_time}">${formatDuration(p.current_duration)}</td>
                            <td class="${statusClass}">${statusText}</td>
                        </tr>
                    `;
                });

                tbody.innerHTML = html || '<tr><td colspan="4" class="text-center">Tidak ada guru yang sedang izin</td></tr>';
                fullTbody.innerHTML = html || '<tr><td colspan="6" class="text-center">Tidak ada guru yang sedang izin</td></tr>';

                // Start real-time counter for active permissions
                startRealTimeCounter();
            })
            .catch(error => console.error('Error loading active permissions:', error));
    }

    // Real-time counter for active permissions
    function startRealTimeCounter() {
        // Clear existing interval if any
        if (window.realTimeCounterInterval) {
            clearInterval(window.realTimeCounterInterval);
        }

        window.realTimeCounterInterval = setInterval(() => {
            const counters = document.querySelectorAll('.duration-counter[data-check-out]');

            counters.forEach(counter => {
                const checkOutTime = new Date(counter.getAttribute('data-check-out'));
                const now = new Date();
                const diffMs = now - checkOutTime;
                const diffMinutes = Math.floor(diffMs / 60000);

                counter.textContent = formatDuration(diffMinutes);

                // Add highlight if more than 60 minutes
                if (diffMinutes > 60) {
                    counter.classList.add('duration-highlight');
                    counter.classList.remove('duration-normal');
                } else {
                    counter.classList.remove('duration-highlight');
                    counter.classList.add('duration-normal');
                }
            });
        }, 1000); // Update every second
    }

    function loadRecentLogs() {
        fetch('/api/logs?limit=10')
            .then(response => response.json())
            .then(data => {
                const tbody = document.getElementById('recentLogsTable');
                
                let html = '';
                data.slice(0, 10).forEach(log => {
                    const actionIcon = log.action === 'check_out' ? '🚪' : log.action === 'check_in' ? '✅' : '❓';
                    html += `
                        <tr>
                            <td>${formatDateTime(log.created_at)}</td>
                            <td>${log.full_name || 'Unknown'}</td>
                            <td>${actionIcon} ${log.action}</td>
                            <td>${log.status}</td>
                        </tr>
                    `;
                });
                
                tbody.innerHTML = html || '<tr><td colspan="4" class="text-center">Belum ada logs</td></tr>';
            })
            .catch(error => console.error('Error loading recent logs:', error));
    }

    // Load Teachers
    let allTeachers = []; // Store all teachers globally for search
    
    function loadTeachers() {
        fetch('/api/teachers')
            .then(response => response.json())
            .then(data => {
                allTeachers = data; // Store data for search
                const tbody = document.getElementById('teachersTable');
                const filterSelect = document.getElementById('filterTeacher');
                
                displayTeachers(data, tbody);
                
                let filterHtml = '<option value="">Semua Guru</option>';
                data.forEach(teacher => {
                    filterHtml += `<option value="${teacher.id}">${teacher.full_name}</option>`;
                });
                filterSelect.innerHTML = filterHtml;
            })
            .catch(error => console.error('Error loading teachers:', error));
    }

    // Display teachers in table
    function displayTeachers(teachers, tbody) {
        let html = '';
        
        teachers.forEach((teacher, index) => {
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td><code>${teacher.rfid_id}</code></td>
                    <td>${teacher.full_name}</td>
                    <td>${teacher.employee_type}</td>
                    <td>${teacher.phone_number || '-'}</td>
                    <td>${teacher.telegram_chat_id || '-'}</td>
                    <td>
                        <button class="btn btn-sm btn-info edit-teacher" data-id="${teacher.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger delete-teacher" data-id="${teacher.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">Belum ada data guru</td></tr>';
        
        // Add event listeners for edit/delete
        document.querySelectorAll('.edit-teacher').forEach(btn => {
            btn.addEventListener('click', function() {
                editTeacher(this.getAttribute('data-id'));
            });
        });
        
        document.querySelectorAll('.delete-teacher').forEach(btn => {
            btn.addEventListener('click', function() {
                deleteTeacher(this.getAttribute('data-id'));
            });
        });
    }

    // Search functionality
    const searchInput = document.getElementById('teacherSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const noResultsMessage = document.getElementById('noResultsMessage');

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase().trim();
            filterTeachers(searchTerm);
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            searchInput.value = '';
            filterTeachers('');
        });
    }

    function filterTeachers(searchTerm) {
        const tbody = document.getElementById('teachersTable');
        
        if (!searchTerm) {
            displayTeachers(allTeachers, tbody);
            noResultsMessage.style.display = 'none';
            return;
        }

        const filteredTeachers = allTeachers.filter(teacher => {
            return (
                teacher.full_name.toLowerCase().includes(searchTerm) ||
                teacher.rfid_id.toLowerCase().includes(searchTerm) ||
                teacher.employee_type.toLowerCase().includes(searchTerm) ||
                (teacher.phone_number && teacher.phone_number.includes(searchTerm))
            );
        });

        if (filteredTeachers.length === 0) {
            tbody.innerHTML = '';
            noResultsMessage.style.display = 'block';
        } else {
            displayTeachers(filteredTeachers, tbody);
            noResultsMessage.style.display = 'none';
        }
    }

    // Add Teacher
    document.getElementById('saveTeacherBtn').addEventListener('click', function() {
        const rfid = document.getElementById('teacherRfid').value;
        const name = document.getElementById('teacherName').value;
        const type = document.getElementById('teacherType').value;
        const phone = document.getElementById('teacherPhone').value;
        const telegram = document.getElementById('teacherTelegram').value;
        
        if (!rfid || !name) {
            alert('RFID ID dan Nama harus diisi');
            return;
        }
        
        fetch('/api/teachers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rfid_id: rfid,
                full_name: name,
                employee_type: type,
                phone_number: phone,
                telegram_chat_id: telegram
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                alert('Guru berhasil ditambahkan');
                bootstrap.Modal.getInstance(document.getElementById('addTeacherModal')).hide();
                document.getElementById('addTeacherForm').reset();
                loadTeachers();
            } else if (data.error) {
                alert(data.error);
            } else {
                alert('Gagal menambahkan guru');
            }
        })
        .catch(error => {
            console.error('Error adding teacher:', error);
            if (error.message) {
                alert(error.message);
            } else {
                alert('Gagal menambahkan guru');
            }
        });
    });

    // Edit Teacher
    function editTeacher(id) {
        fetch('/api/teachers')
            .then(response => response.json())
            .then(data => {
                const teacher = data.find(t => t.id == id);
                if (teacher) {
                    document.getElementById('editTeacherId').value = teacher.id;
                    document.getElementById('editTeacherRfid').value = teacher.rfid_id;
                    document.getElementById('editTeacherName').value = teacher.full_name;
                    document.getElementById('editTeacherType').value = teacher.employee_type;
                    document.getElementById('editTeacherPhone').value = teacher.phone_number || '';
                    document.getElementById('editTeacherTelegram').value = teacher.telegram_chat_id || '';
                    
                    new bootstrap.Modal(document.getElementById('editTeacherModal')).show();
                }
            });
    }

    document.getElementById('updateTeacherBtn').addEventListener('click', function() {
        const id = document.getElementById('editTeacherId').value;
        const rfid = document.getElementById('editTeacherRfid').value;
        const name = document.getElementById('editTeacherName').value;
        const type = document.getElementById('editTeacherType').value;
        const phone = document.getElementById('editTeacherPhone').value;
        const telegram = document.getElementById('editTeacherTelegram').value;
        
        fetch(`/api/teachers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rfid_id: rfid,
                full_name: name,
                employee_type: type,
                phone_number: phone,
                telegram_chat_id: telegram,
                is_active: true
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                alert('Guru berhasil diupdate');
                bootstrap.Modal.getInstance(document.getElementById('editTeacherModal')).hide();
                loadTeachers();
            } else {
                alert('Gagal mengupdate guru');
            }
        })
        .catch(error => {
            console.error('Error updating teacher:', error);
            alert('Gagal mengupdate guru');
        });
    });

    // Delete Teacher
    function deleteTeacher(id) {
        if (confirm('Apakah Anda yakin ingin menghapus guru ini?')) {
            fetch(`/api/teachers/${id}`, { method: 'DELETE' })
                .then(response => response.json())
                .then(data => {
                    if (data.message) {
                        alert('Guru berhasil dihapus');
                        loadTeachers();
                    } else {
                        alert('Gagal menghapus guru');
                    }
                })
                .catch(error => {
                    console.error('Error deleting teacher:', error);
                    alert('Gagal menghapus guru');
                });
        }
    }

    // Load Permissions
    function loadPermissions() {
        loadActivePermissions();
        loadPermissionHistory();
        loadYearSelect();
    }

    function loadPermissionHistory() {
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;
        const teacherId = document.getElementById('filterTeacher').value;

        // Default to today's date if no filter is set
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let url = '/api/permissions/history?';
        if (startDate) {
            url += `start_date=${startDate}&`;
        } else {
            url += `start_date=${todayStr}&`;
        }
        if (endDate) {
            url += `end_date=${endDate}&`;
        } else {
            url += `end_date=${todayStr}&`;
        }
        if (teacherId) url += `teacher_id=${teacherId}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                const tbody = document.getElementById('historyTableBody');

                let html = '';
                data.forEach((p, index) => {
                    const statusBadge = p.status === 'out'
                        ? '<span class="badge badge-warning">Keluar</span>'
                        : '<span class="badge badge-success">Kembali</span>';

                    html += `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${p.full_name}</td>
                            <td>${p.employee_type}</td>
                            <td>${formatDateTime(p.check_out_time)}</td>
                            <td>${p.check_in_time ? formatDateTime(p.check_in_time) : '-'}</td>
                            <td>${formatDuration(p.duration_minutes)}</td>
                            <td>${statusBadge}</td>
                        </tr>
                    `;
                });

                tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">Belum ada riwayat izin hari ini</td></tr>';
            })
            .catch(error => console.error('Error loading permission history:', error));
    }

    document.getElementById('filterBtn').addEventListener('click', loadPermissionHistory);
    document.getElementById('resetFilterBtn').addEventListener('click', function() {
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.getElementById('filterTeacher').value = '';
        loadPermissionHistory();
    });

    // Export Excel
    document.getElementById('exportExcelBtn').addEventListener('click', function() {
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;
        
        let url = '/api/export/excel?';
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}`;
        
        window.open(url, '_blank');
    });

    // Print
    document.getElementById('printBtn').addEventListener('click', function() {
        window.print();
    });

    // Monthly Recap
    function loadYearSelect() {
        const yearSelect = document.getElementById('yearSelect');
        const currentYear = new Date().getFullYear();
        
        for (let i = currentYear; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
        
        document.getElementById('monthSelect').value = new Date().getMonth() + 1;
    }

    document.getElementById('loadMonthlyBtn').addEventListener('click', function() {
        const month = document.getElementById('monthSelect').value;
        const year = document.getElementById('yearSelect').value;
        
        fetch(`/api/permissions/monthly/${year}/${month}`)
            .then(response => response.json())
            .then(data => {
                const tbody = document.getElementById('monthlyTableBody');
                
                let html = '';
                data.forEach((p, index) => {
                    const statusBadge = p.status === 'out' 
                        ? '<span class="badge badge-warning">Keluar</span>' 
                        : '<span class="badge badge-success">Kembali</span>';
                    
                    html += `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${p.full_name}</td>
                            <td>${p.employee_type}</td>
                            <td>${formatDateTime(p.check_out_time)}</td>
                            <td>${p.check_in_time ? formatDateTime(p.check_in_time) : '-'}</td>
                            <td>${formatDuration(p.duration_minutes)}</td>
                            <td>${statusBadge}</td>
                        </tr>
                    `;
                });
                
                tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">Tidak ada data untuk bulan ini</td></tr>';
            })
            .catch(error => console.error('Error loading monthly permissions:', error));
    });

    // Export Monthly Excel
    document.getElementById('exportMonthlyExcelBtn').addEventListener('click', function() {
        const month = document.getElementById('monthSelect').value;
        const year = document.getElementById('yearSelect').value;
        window.location.href = `/api/permissions/monthly/${year}/${month}/export/excel`;
    });

    // Export Monthly Word
    document.getElementById('exportMonthlyWordBtn').addEventListener('click', function() {
        const month = document.getElementById('monthSelect').value;
        const year = document.getElementById('yearSelect').value;
        window.location.href = `/api/permissions/monthly/${year}/${month}/export/word`;
    });

    // Print Monthly
    document.getElementById('printMonthlyBtn').addEventListener('click', function() {
        const month = document.getElementById('monthSelect').value;
        const year = document.getElementById('yearSelect').value;
        window.open(`/api/permissions/monthly/${year}/${month}/print`, '_blank');
    });

    // Load Devices
    function loadDevices() {
        fetch('/api/devices')
            .then(response => response.json())
            .then(data => {
                const container = document.getElementById('devicesContainer');

                let html = '';
                data.forEach(device => {
                    const statusClass = device.status;
                    const statusText = device.status.charAt(0).toUpperCase() + device.status.slice(1);
                    const statusIcon = device.status === 'online' ? 'fa-circle-check' : device.status === 'offline' ? 'fa-circle-xmark' : 'fa-circle-exclamation';

                    // MQTT connection status (based on device status)
                    const mqttConnected = device.status === 'online';
                    const mqttStatusText = mqttConnected ? 'Terhubung' : 'Terputus';
                    const mqttStatusClass = mqttConnected ? 'text-success' : 'text-danger';
                    const mqttStatusIcon = mqttConnected ? 'fa-wifi' : 'fa-wifi-slash';

                    html += `
                        <div class="col-md-6 col-lg-4">
                            <div class="device-card ${statusClass}">
                                <div class="device-header">
                                    <h5><i class="fas fa-microchip"></i> ${device.device_name}</h5>
                                    <span class="device-status ${statusClass}">
                                        <i class="fas ${statusIcon}"></i> ${statusText}
                                    </span>
                                </div>
                                <div class="device-info">
                                    <p><strong>ID:</strong> <code>${device.device_id}</code></p>
                                    <p><strong>Tipe:</strong> ${device.device_type}</p>
                                    <p><strong>IP Address:</strong> <code>${device.ip_address || 'N/A'}</code></p>
                                    <p><strong>MQTT:</strong> <span class="${mqttStatusClass}"><i class="fas ${mqttStatusIcon}"></i> ${mqttStatusText}</span></p>
                                    <p><strong>Terakhir Dilihat:</strong> ${device.last_seen ? formatDateTime(device.last_seen) : 'N/A'}</p>
                                    <p><strong>MQTT Topic:</strong> <code>${device.mqtt_topic || 'N/A'}</code></p>
                                </div>
                            </div>
                        </div>
                    `;
                });

                container.innerHTML = html || '<div class="col-12"><p class="text-center text-muted">Tidak ada device terdaftar</p></div>';
            })
            .catch(error => console.error('Error loading devices:', error));
    }

    // Load Logs
    function loadLogs() {
        fetch('/api/logs')
            .then(response => response.json())
            .then(data => {
                const tbody = document.getElementById('logsTable');
                
                let html = '';
                data.forEach((log, index) => {
                    const actionIcon = log.action === 'check_out' ? '🚪' : log.action === 'check_in' ? '✅' : '❓';
                    
                    html += `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${formatDateTime(log.created_at)}</td>
                            <td><code>${log.rfid_id}</code></td>
                            <td>${log.full_name || 'Unknown'}</td>
                            <td>${actionIcon} ${log.action}</td>
                            <td>${log.status}</td>
                            <td>${log.message || '-'}</td>
                            <td>${log.device_id || '-'}</td>
                        </tr>
                    `;
                });
                
                tbody.innerHTML = html || '<tr><td colspan="8" class="text-center">Belum ada logs</td></tr>';
            })
            .catch(error => console.error('Error loading logs:', error));
    }

    // Utility function to format datetime
    function formatDateTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Utility function to format duration
    function formatDuration(minutes) {
        if (!minutes || minutes === 0) return '-';

        const days = Math.floor(minutes / (24 * 60));
        const hours = Math.floor((minutes % (24 * 60)) / 60);
        const mins = minutes % 60;

        let result = [];
        if (days > 0) result.push(`${days} hari`);
        if (hours > 0) result.push(`${hours} jam`);
        if (mins > 0) result.push(`${mins} menit`);

        return result.join(' ') || '-';
    }

    // Auto-refresh active permissions every 30 seconds
    setInterval(() => {
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'dashboardPage') {
            loadDashboard();
        } else if (activePage && activePage.id === 'permissionsPage') {
            loadActivePermissions();
        }
    }, 30000);
});
