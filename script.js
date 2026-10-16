
const RATE = 50;

const pcSpecs = [
    "Intel i5 • 16GB RAM • RTX 3060",
    "Ryzen 5 • 16GB RAM • RX 6600",
    "Intel i3 • 8GB RAM • GTX 1650",
    "Intel i5 • 16GB RAM • RTX 3050",
    "Ryzen 5 • 16GB RAM • GTX 1660",
    "Intel i5 • 8GB RAM • GTX 1650"
];

const pcs = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    name: "PC " + String(index + 1).padStart(2, "0"),
    specs: pcSpecs[index % pcSpecs.length]
}));

const supabaseClient = window.pcHubSupabase;
let currentUser = null;
let currentUserId = null;
let currentAdmin = null;
let currentRole = null;
let accountCache = [];
let rentalCache = [];
let occupiedPcIds = [];
let refreshingExpiredRental = false;
let chosenPc = null;


function getAccounts() {
    return accountCache;
}

function getAdminAccounts() {
    return accountCache.filter(account => account.role === "admin");
}

function getRentals() {
    return rentalCache;
}

function mapRental(row) {
    return {
        id: row.id,
        userId: row.user_id,
        email: row.email,
        pcId: row.pc_id,
        hours: row.hours,
        total: row.total,
        startedAt: new Date(row.started_at).getTime(),
        endsAt: new Date(row.ends_at).getTime(),
        endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
        status: row.status
    };
}

async function loadUserData(user) {
    currentUser = user.email.toLowerCase();
    currentUserId = user.id;

    const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("user_id,email,full_name,role")
        .eq("user_id", user.id)
        .single();
    if (profileError) throw profileError;

    currentRole = profile.role;
    currentAdmin = profile.role === "admin" ? currentUser : null;
    const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("user_id,email,full_name,role")
        .order("full_name");
    if (profilesError) throw profilesError;
    accountCache = profiles.map(item => ({
        id: item.user_id,
        email: item.email,
        name: item.full_name,
        role: item.role
    }));
    await refreshRentalData();
}

async function refreshRentalData() {
    const { error: expireError } = await supabaseClient.rpc("refresh_expired_rentals");
    if (expireError) throw expireError;

    const { data: rentals, error: rentalError } = await supabaseClient
        .from("rentals")
        .select("id,user_id,pc_id,hours,total,started_at,ends_at,ended_at,status")
        .order("started_at", { ascending: false });
    if (rentalError) throw rentalError;

    const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("user_id,email,full_name,role")
        .order("full_name");
    if (profilesError) throw profilesError;
    accountCache = profiles.map(item => ({
        id: item.user_id,
        email: item.email,
        name: item.full_name,
        role: item.role
    }));
    const emailByUser = new Map(accountCache.map(account => [account.id, account.email]));
    rentalCache = rentals.map(row => ({
        ...mapRental(row),
        email: emailByUser.get(row.user_id) || ""
    }));

    const { data: occupied, error: occupiedError } = await supabaseClient.rpc("get_active_pc_ids");
    if (occupiedError) throw occupiedError;
    occupiedPcIds = occupied.map(item => item.pc_id);
}

function showDataError(error) {
    const message = document.getElementById("appError");
    if (message) {
        message.textContent = "Could not load data from Supabase: " + error.message;
        message.classList.remove("hidden");
    }
}

function supabaseReady(errorElement) {
    if (supabaseClient) return true;
    errorElement.textContent = "Supabase client could not load. Check your internet connection and refresh.";
    return false;
}

function money(amount) {
    return "₱" + amount.toLocaleString("en-PH");
}

function isGmailAddress(email) {
    return /^[^\s@]+@gmail\.com$/i.test(email);
}

document.querySelectorAll(".password-toggle").forEach(button => {
    button.addEventListener("click", function() {
        const input = document.getElementById(button.getAttribute("aria-controls"));
        const isVisible = input.type === "text";

        input.type = isVisible ? "password" : "text";
        button.setAttribute("aria-pressed", String(!isVisible));
        button.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    });
});


async function refreshExpiredRentals() {
    if (!currentUserId || refreshingExpiredRental) return;
    refreshingExpiredRental = true;
    try {
        await refreshRentalData();
    } finally {
        refreshingExpiredRental = false;
    }
}

function activeRentals() {
    return getRentals().filter(rental =>
        rental.status === "Active" && Date.now() < rental.endsAt
    );
}

function myActiveRental() {
    return activeRentals().find(rental => rental.email === currentUser);
}


async function showPage(page) {
    const customerPages = [
        "dashboard", "computers", "rent", "session", "history"
    ];
    if (page === "adminDashboard" && currentRole !== "admin") {
        page = "adminLogin";
    } else if (customerPages.includes(page)) {
        if (currentRole === "admin") {
            page = "adminDashboard";
        } else if (!currentUser) {
            page = "login";
        }
    }

    document.querySelectorAll("main > section").forEach(section => {
        section.classList.add("hidden");
    });

    document.getElementById(page).classList.remove("hidden");

    document.getElementById("nav").classList.toggle(
        "hidden", !currentUser || currentRole !== "customer"
    );
    document.getElementById("appError").classList.add("hidden");

    document.querySelectorAll("#nav button[data-page]").forEach(button => {
        const isActive = button.dataset.page === page ||
            (page === "rent" && button.dataset.page === "computers");

        button.classList.toggle("active", isActive);
        if (isActive) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    if (page === "dashboard" || page === "computers" || page === "rent" ||
        page === "session" || page === "history" || page === "adminDashboard") {
        try {
            await refreshRentalData();
        } catch (error) {
            showDataError(error);
        }
    }
    if (page === "dashboard") renderDashboard();
    if (page === "computers") renderComputers();
    if (page === "session") renderSession();
    if (page === "history") renderHistory();
    if (page === "adminDashboard") renderAdminDashboard();
}

function openAdminAccess() {
    showPage("adminLogin");
}

function showAdminView(view) {
    document.querySelectorAll(".admin-view").forEach(section => {
        section.classList.toggle("hidden", section.id !== "adminView-" + view);
    });
    document.querySelectorAll(".admin-side-nav [data-admin-view]").forEach(button => {
        const active = button.dataset.adminView === view;
        button.classList.toggle("active", active);
        if (active) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });
    if (view === "transactions" || view === "returning" || view === "team") {
        renderAdminDashboard();
    }
}

document.getElementById("registerForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirm").value;
    const error = document.getElementById("regError");

    error.textContent = "";
    error.classList.remove("success-message");
    if (!supabaseReady(error)) return;

    if (!isGmailAddress(email)) {
        error.textContent = "Please use a valid @gmail.com address.";
        return;
    }

    if (!name) {
        error.textContent = "Please enter your name.";
        return;
    }

    if (password !== confirmPassword) {
        error.textContent = "Passwords do not match.";
        return;
    }

    const { data, error: signUpError } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: name } }
    });
    if (signUpError) {
        error.textContent = signUpError.message;
        return;
    }

    event.target.reset();
    if (data.session) {
        try {
            await loadUserData(data.user);
            await showPage(currentRole === "admin" ? "adminDashboard" : "dashboard");
        } catch (loadError) {
            error.textContent = loadError.message;
            await supabaseClient.auth.signOut();
        }
    } else {
        error.classList.add("success-message");
        error.textContent = "Account created. Check your email to confirm it, then log in.";
    }
});


document.getElementById("loginForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const errorMessage = document.getElementById("loginError");
    errorMessage.textContent = "";
    if (!supabaseReady(errorMessage)) return;

    if (!isGmailAddress(email)) {
        errorMessage.textContent = "Please use your @gmail.com address.";
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (error) {
        errorMessage.textContent = error.message;
        return;
    }

    try {
        await loadUserData(data.user);
    } catch (profileError) {
        errorMessage.textContent = profileError.message;
        await supabaseClient.auth.signOut();
        return;
    }
    event.target.reset();
    await showPage(currentRole === "admin" ? "adminDashboard" : "dashboard");
});

document.getElementById("adminLoginForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const email = document.getElementById("adminLoginEmail").value.trim().toLowerCase();
    const password = document.getElementById("adminLoginPassword").value;
    const error = document.getElementById("adminLoginError");
    error.textContent = "";
    if (!supabaseReady(error)) return;

    if (!isGmailAddress(email)) {
        error.textContent = "Please use your @gmail.com address.";
        return;
    }
    const { data, error: loginError } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (loginError) {
        error.textContent = loginError.message;
        return;
    }

    try {
        await loadUserData(data.user);
    } catch (profileError) {
        error.textContent = profileError.message;
        await supabaseClient.auth.signOut();
        return;
    }
    if (currentRole !== "admin") {
        error.textContent = "This account is not an admin yet. Complete the admin setup steps first.";
        await supabaseClient.auth.signOut();
        currentUser = null;
        currentUserId = null;
        currentAdmin = null;
        currentRole = null;
        return;
    }
    event.target.reset();
    await showPage("adminDashboard");
});

document.getElementById("addAdminForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const email = document.getElementById("newAdminEmail").value.trim().toLowerCase();
    const error = document.getElementById("addAdminError");
    const success = document.getElementById("addAdminSuccess");
    error.textContent = "";
    success.textContent = "";
    if (!supabaseReady(error)) return;

    if (!isGmailAddress(email)) {
        error.textContent = "Please use a valid @gmail.com address.";
        return;
    }
    const { error: grantError } = await supabaseClient.rpc("grant_admin_for_email", {
        target_email: email
    });
    if (grantError) {
        error.textContent = grantError.message;
        return;
    }
    event.target.reset();
    success.textContent = "Admin access granted.";
    try {
        await refreshRentalData();
        renderAdminDashboard();
    } catch (refreshError) {
        showDataError(refreshError);
    }
});


async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        showDataError(error);
        return;
    }
    currentUser = null;
    currentUserId = null;
    currentAdmin = null;
    currentRole = null;
    accountCache = [];
    rentalCache = [];
    occupiedPcIds = [];
    await showPage("landing");
}

// USER DASHBOARD
function renderDashboard() {
    const user = getAccounts().find(account => account.email === currentUser);
    const rentals = activeRentals();
    const occupied = occupiedPcIds;
    const rental = rentals.find(item => item.email === currentUser);

    document.getElementById("welcome").textContent =
        "Welcome back, " + (user ? user.name : "Customer") + "!";

    document.getElementById("availableCount").textContent =
        pcs.length - occupied.length;
    document.getElementById("totalPcCount").textContent = pcs.length;

    document.getElementById("activeCount").textContent =
        rental ? "Active" : "None";

    const list = document.getElementById("dashboardPcList");
    list.replaceChildren();

    pcs.forEach(pc => {
        const busy = occupied.includes(pc.id);
        const row = document.createElement("div");
        row.className = "dashboard-pc-row";

        const screen = document.createElement("div");
        screen.className = "dashboard-pc-screen" + (busy ? " is-busy" : "");
        screen.textContent = String(pc.id).padStart(2, "0");

        const details = document.createElement("div");
        details.className = "dashboard-pc-details";

        const name = document.createElement("strong");
        name.textContent = pc.name;
        const specs = document.createElement("span");
        specs.textContent = pc.specs;
        details.append(name, specs);

        const status = document.createElement("span");
        status.className = "dashboard-pc-status " + (busy ? "is-busy" : "is-available");
        status.textContent = busy ? "In Use" : "Available";

        const button = document.createElement("button");
        button.className = busy ? "dashboard-rent-button is-disabled" : "dashboard-rent-button";
        button.textContent = busy ? "Unavailable" : rental ? "Already Renting" : "Rent Now →";
        button.disabled = busy || !!rental;
        button.onclick = function() {
            selectComputer(pc.id);
        };

        row.append(screen, details, status, button);
        list.appendChild(row);
    });

    renderDashboardRental(rental);
}

function renderDashboardRental(rental) {
    const content = document.getElementById("dashboardRentalContent");
    content.replaceChildren();

    if (!rental) {
        const message = document.createElement("p");
        message.className = "dashboard-no-rental";
        message.textContent = "No active rental. Choose an available computer above to get started.";

        const button = document.createElement("button");
        button.className = "dashboard-text-button";
        button.textContent = "Browse computers →";
        button.onclick = function() {
            showPage("computers");
        };

        content.append(message, button);
        return;
    }

    const pc = pcs.find(item => item.id === rental.pcId);

    const computer = document.createElement("div");
    computer.className = "dashboard-rental-computer";
    const screen = document.createElement("div");
    screen.className = "dashboard-pc-screen is-busy";
    screen.textContent = String(rental.pcId).padStart(2, "0");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = pc.name;
    const specs = document.createElement("span");
    specs.textContent = pc.specs;
    details.append(name, specs);
    computer.append(screen, details);

    const time = document.createElement("div");
    time.className = "dashboard-rental-stat";
    const timeLabel = document.createElement("span");
    timeLabel.textContent = "TIME LEFT";
    const timer = document.createElement("strong");
    timer.id = "dashboardTimer";
    time.append(timeLabel, timer);

    const duration = document.createElement("div");
    duration.className = "dashboard-rental-stat";
    const durationLabel = document.createElement("span");
    durationLabel.textContent = "DURATION";
    const durationValue = document.createElement("strong");
    durationValue.textContent = rental.hours + (rental.hours === 1 ? " hour" : " hours");
    duration.append(durationLabel, durationValue);

    const total = document.createElement("div");
    total.className = "dashboard-rental-stat";
    const totalLabel = document.createElement("span");
    totalLabel.textContent = "TOTAL";
    const totalValue = document.createElement("strong");
    totalValue.textContent = money(rental.total);
    total.append(totalLabel, totalValue);

    const endButton = document.createElement("button");
    endButton.className = "danger dashboard-end-button";
    endButton.textContent = "End Session";
    endButton.onclick = endSession;

    content.append(computer, time, duration, total, endButton);
    updateTimer();
}


function renderComputers() {
    const occupied = occupiedPcIds;
    const alreadyRenting = !!myActiveRental();

    const list = document.getElementById("pcList");
    list.replaceChildren();

    pcs.forEach(pc => {
        const busy = occupied.includes(pc.id);

        const card = document.createElement("div");
        card.className = "dashboard-pc-row";

        const screen = document.createElement("div");
        screen.className = "dashboard-pc-screen" + (busy ? " is-busy" : "");
        screen.textContent = String(pc.id).padStart(2, "0");

        const details = document.createElement("div");
        details.className = "dashboard-pc-details";
        const title = document.createElement("strong");
        title.textContent = pc.name;
        const specs = document.createElement("span");
        specs.textContent = pc.specs;
        details.append(title, specs);

        const status = document.createElement("span");
        status.className = "dashboard-pc-status " + (busy ? "is-busy" : "is-available");
        status.textContent = busy ? "In Use" : "Available";

        const button = document.createElement("button");
        button.className = "dashboard-rent-button" + (busy ? " is-disabled" : "");

        if (busy) {
            button.textContent = "Unavailable";
        } else if (alreadyRenting) {
            button.textContent = "Already Renting";
        } else {
            button.textContent = "Rent Now →";
        }

        button.disabled = busy || alreadyRenting;
        button.onclick = function() {
            selectComputer(pc.id);
        };

        card.append(screen, details, status, button);
        list.appendChild(card);
    });
}


function selectComputer(id) {
    if (myActiveRental() || occupiedPcIds.includes(id)) {
        showPage("computers");
        return;
    }

    chosenPc = pcs.find(pc => pc.id === id);

    document.getElementById("selectedPc").textContent = chosenPc.name;
    document.getElementById("selectedSpecs").textContent = chosenPc.specs;
    document.getElementById("summaryPc").textContent = chosenPc.name;

    document.getElementById("duration").value = "1";

    updateTotal();
    showPage("rent");
}


function updateTotal() {
    const hours = Number(document.getElementById("duration").value);

    document.getElementById("summaryDuration").textContent =
        hours + (hours === 1 ? " hour" : " hours");

    document.getElementById("totalPrice").textContent =
        money(hours * RATE);
}


async function confirmRental() {
    if (!chosenPc) {
        showPage("computers");
        return;
    }

    if (myActiveRental() || occupiedPcIds.includes(chosenPc.id)) {
        alert("This computer is no longer available, or you already have an active rental.");
        showPage("computers");
        return;
    }

    const hours = Number(document.getElementById("duration").value);
    const { error } = await supabaseClient.rpc("start_rental", {
        requested_pc_id: chosenPc.id,
        requested_hours: hours
    });
    if (error) {
        alert(error.message);
        await showPage("computers");
        return;
    }
    chosenPc = null;

    alert("Rental confirmed! Your timer starts now.");

    await showPage("session");
}


function renderSession() {
    const rental = myActiveRental();
    const box = document.getElementById("sessionDetails");

    box.replaceChildren();

    if (!rental) {
        box.classList.add("session-empty");
        const message = document.createElement("p");
        message.className = "session-empty-message";
        message.textContent = "You do not have an active rental.";

        const button = document.createElement("button");
        button.className = "primary";
        button.textContent = "Rent a Computer";
        button.onclick = function() {
            showPage("computers");
        };

        box.append(message, button);
        return;
    }

    box.classList.remove("session-empty");
    const pc = pcs.find(item => item.id === rental.pcId);

    const sessionTop = document.createElement("div");
    sessionTop.className = "session-card-top";

    const computer = document.createElement("div");
    computer.className = "session-computer";
    const screen = document.createElement("div");
    screen.className = "dashboard-pc-screen";
    screen.textContent = String(rental.pcId).padStart(2, "0");

    const title = document.createElement("h2");
    title.textContent = pc.name;

    const specs = document.createElement("p");
    specs.textContent = pc.specs;
    computer.append(screen, title, specs);

    const badge = document.createElement("span");
    badge.className = "session-live-badge";
    badge.textContent = "Session active";
    sessionTop.append(computer, badge);

    const note = document.createElement("p");
    note.className = "session-timer-label";
    note.textContent = "TIME REMAINING";

    const timer = document.createElement("div");
    timer.className = "timer";
    timer.id = "timer";

    const details = document.createElement("div");
    details.className = "session-facts";
    [
        ["DURATION", rental.hours + (rental.hours === 1 ? " hour" : " hours")],
        ["RENTAL TOTAL", money(rental.total)],
        ["STARTED AT", new Date(rental.startedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })]
    ].forEach(([label, value]) => {
        const fact = document.createElement("div");
        fact.className = "session-fact";
        const factLabel = document.createElement("span");
        factLabel.textContent = label;
        const factValue = document.createElement("strong");
        factValue.textContent = value;
        fact.append(factLabel, factValue);
        details.appendChild(fact);
    });

    const endButton = document.createElement("button");
    endButton.className = "danger";
    endButton.textContent = "End Session";
    endButton.onclick = endSession;

    box.append(sessionTop, note, timer, details, endButton);

    updateTimer();
}


function updateTimer() {
    const timer = document.getElementById("timer") ||
        document.getElementById("dashboardTimer");

    if (!timer || timer.closest(".hidden")) {
        return;
    }

    const rental = myActiveRental();

    if (!rental) {
        const hasExpiredRental = getRentals().some(item =>
            item.email === currentUser &&
            item.status === "Active" &&
            Date.now() >= item.endsAt
        );
        if (hasExpiredRental) {
            refreshExpiredRentals().then(() => {
                if (!document.getElementById("session").classList.contains("hidden")) {
                    renderSession();
                } else if (!document.getElementById("dashboard").classList.contains("hidden")) {
                    renderDashboard();
                }
            }).catch(showDataError);
            return;
        }
        if (timer.id === "dashboardTimer") {
            renderDashboard();
        } else {
            renderSession();
        }
        return;
    }

    const remaining = Math.max(0, rental.endsAt - Date.now());
    if (remaining === 0) {
        refreshExpiredRentals().then(() => {
            if (document.getElementById("session").classList.contains("hidden") === false) {
                renderSession();
            } else if (document.getElementById("dashboard").classList.contains("hidden") === false) {
                renderDashboard();
            }
        }).catch(showDataError);
        return;
    }

    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    timer.textContent = [hours, minutes, seconds]
        .map(number => String(number).padStart(2, "0"))
        .join(":");
}


async function endSession() {
    if (!confirm("End your rental session now?")) {
        return;
    }

    const rental = myActiveRental();

    if (!rental) {
        return;
    }

    const { error } = await supabaseClient.rpc("end_rental", {
        requested_rental_id: rental.id
    });
    if (error) {
        showDataError(error);
        return;
    }
    await showPage("history");
}


function renderHistory() {
    const rows = document.getElementById("historyRows");
    rows.replaceChildren();

    const mine = getRentals()
        .filter(rental => rental.email === currentUser)
        .sort((a, b) => b.startedAt - a.startedAt);

    document.getElementById("historyTotal").textContent = mine.length;
    document.getElementById("historyCompleted").textContent =
        mine.filter(rental => rental.status === "Completed").length;
    document.getElementById("historySpent").textContent =
        money(mine.reduce((total, rental) => total + rental.total, 0));

    if (mine.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.className = "history-empty";
        cell.textContent = "No rentals yet.";

        row.appendChild(cell);
        rows.appendChild(row);
    }

    mine.forEach(rental => {
        const row = document.createElement("tr");

        const values = [
            new Date(rental.startedAt).toLocaleString("en-PH"),
            "PC " + String(rental.pcId).padStart(2, "0"),
            rental.hours + " hour(s)",
            money(rental.total),
            rental.status
        ];

        values.forEach((value, index) => {
            const cell = document.createElement("td");
            if (index === 4) {
                const status = document.createElement("span");
                status.className = "history-status " +
                    (rental.status === "Active" ? "is-active" : "is-completed");
                status.textContent = value;
                cell.appendChild(status);
            } else {
                cell.textContent = value;
            }
            row.appendChild(cell);
        });

        rows.appendChild(row);
    });
}

function renderAdminDashboard() {
    const admin = getAdminAccounts().find(account => account.email === currentAdmin);
    document.getElementById("adminWelcome").textContent =
        "Welcome, " + (admin ? admin.name : "Admin");

    const rentals = getRentals().sort((a, b) => b.startedAt - a.startedAt);
    const active = rentals.filter(rental => rental.status === "Active");
    const occupiedPcs = new Set(active.map(rental => rental.pcId));
    const revenue = rentals.reduce((sum, rental) => sum + Number(rental.total || 0), 0);

    document.getElementById("adminAvailablePcs").textContent =
        String(Math.max(0, pcs.length - occupiedPcs.size));
    document.getElementById("adminPcCapacity").textContent =
        "of " + pcs.length + " computers";
    document.getElementById("adminActiveSessions").textContent = String(active.length);
    document.getElementById("adminTotalRentals").textContent = String(rentals.length);
    document.getElementById("adminRevenue").textContent = money(revenue);
    document.getElementById("adminOccupancy").textContent =
        occupiedPcs.size + " / " + pcs.length + " occupied";

    const pcStatus = document.getElementById("adminPcStatus");
    pcStatus.replaceChildren();
    pcs.forEach(pc => {
        const chip = document.createElement("span");
        const isOccupied = occupiedPcs.has(pc.id);
        chip.className = "admin-pc-chip" + (isOccupied ? " is-occupied" : "");
        chip.textContent = String(pc.id).padStart(2, "0");
        chip.title = pc.name + (isOccupied ? " · In use" : " · Available");
        pcStatus.appendChild(chip);
    });

    const transactionRows = document.getElementById("adminTransactionRows");
    transactionRows.replaceChildren();
    if (rentals.length === 0) {
        appendAdminEmptyRow(transactionRows, 7, "No rental transactions yet.");
    }
    rentals.forEach(rental => {
        const row = document.createElement("tr");
        const cells = [
            new Date(rental.startedAt).toLocaleString("en-PH"),
            customerName(rental.email),
            rental.email,
            "PC " + String(rental.pcId).padStart(2, "0"),
            rental.hours + (rental.hours === 1 ? " hour" : " hours"),
            money(Number(rental.total || 0))
        ];
        cells.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.className = "history-status " +
            (rental.status === "Active" ? "is-active" : "is-completed");
        status.textContent = rental.status;
        statusCell.appendChild(status);
        row.appendChild(statusCell);
        transactionRows.appendChild(row);
    });

    const recent = document.getElementById("adminRecentTransactions");
    recent.replaceChildren();
    if (rentals.length === 0) {
        const empty = document.createElement("p");
        empty.className = "admin-empty";
        empty.textContent = "No rentals have been recorded yet.";
        recent.appendChild(empty);
    }
    rentals.slice(0, 5).forEach(rental => {
        const item = document.createElement("div");
        item.className = "admin-recent-item";
        const summary = document.createElement("div");
        const who = document.createElement("strong");
        who.textContent = customerName(rental.email);
        const detail = document.createElement("span");
        detail.textContent = "PC " + String(rental.pcId).padStart(2, "0") +
            " · " + new Date(rental.startedAt).toLocaleDateString("en-PH");
        summary.append(who, detail);
        const total = document.createElement("strong");
        total.className = "admin-recent-total";
        total.textContent = money(Number(rental.total || 0));
        item.append(summary, total);
        recent.appendChild(item);
    });

    const rentalCounts = new Map();
    rentals.forEach(rental => {
        const customer = rentalCounts.get(rental.email) || {
            email: rental.email,
            name: customerName(rental.email),
            count: 0,
            spent: 0,
            lastVisit: 0
        };
        customer.count += 1;
        customer.spent += Number(rental.total || 0);
        customer.lastVisit = Math.max(customer.lastVisit, rental.startedAt);
        rentalCounts.set(rental.email, customer);
    });
    const customers = Array.from(rentalCounts.values())
        .sort((a, b) => b.count - a.count || b.lastVisit - a.lastVisit);
    const returning = customers.filter(customer => customer.count > 1);
    document.getElementById("adminReturningCount").textContent = String(returning.length);
    document.getElementById("adminCustomerCount").textContent = String(customers.length);

    const returningRows = document.getElementById("adminReturningRows");
    returningRows.replaceChildren();
    if (returning.length === 0) {
        appendAdminEmptyRow(returningRows, 5, "No returning customers yet.");
    }
    returning.forEach(customer => {
        const row = document.createElement("tr");
        [
            customer.name,
            customer.email,
            String(customer.count),
            money(customer.spent),
            new Date(customer.lastVisit).toLocaleDateString("en-PH")
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        returningRows.appendChild(row);
    });

    const accountList = document.getElementById("adminAccountList");
    accountList.replaceChildren();
    getAdminAccounts().forEach(account => {
        const item = document.createElement("div");
        item.className = "admin-account-item";
        const identity = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = account.name || account.email;
        const email = document.createElement("span");
        email.textContent = account.email;
        identity.append(name, email);
        const badge = document.createElement("span");
        badge.className = "admin-role-badge";
        badge.textContent = account.email === currentAdmin ? "You" : "Admin";
        item.append(identity, badge);
        accountList.appendChild(item);
    });
}

function customerName(email) {
    const customer = getAccounts().find(account => account.email === email);
    return customer ? customer.name : email;
}

function appendAdminEmptyRow(tbody, columns, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.className = "admin-empty-cell";
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
}


setInterval(updateTimer, 1000);


async function initializeApp() {
    if (!supabaseClient) {
        showDataError({ message: "Supabase client failed to load. Check your internet connection and refresh." });
        return;
    }
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        await showPage("landing");
        showDataError(error);
        return;
    }
    if (!data.session) {
        await showPage("landing");
        return;
    }
    try {
        await loadUserData(data.session.user);
        await showPage(currentRole === "admin" ? "adminDashboard" : "dashboard");
    } catch (loadError) {
        await showPage("landing");
        showDataError(loadError);
    }
}

initializeApp();
