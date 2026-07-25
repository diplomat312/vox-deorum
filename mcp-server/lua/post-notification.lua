-- Post-Notification Lua Script
-- Raises a native Vox Deorum notification on a player's notification panel.
-- A counterpartID >= 0 makes the notification open the diplomacy conversation on
-- click; a counterpartID of -1 (no counterpart) makes it show `message` in a text
-- dialog on click. `message` is stored as the notification tooltip, which the
-- diplomacy panel caches for that click-to-show path.

-- Pinned-observer redirect. CvNotifications::Add only DISPLAYS a newly posted notification when
-- its recipient is the active player. A human strategist plays as an observer whose UI is pinned
-- to a civilization seat (Game.GetObserverUIOverridePlayer), so the backend correctly addresses
-- the pinned seat while the active player is the observer slot — and the notification would never
-- appear. When, and only when, all three conditions hold (the request is not already for the
-- active player, the active player really is an observer, and its UI override is exactly the
-- requested seat), deliver to the observer instead. A PURE observer (no override) keeps its own
-- real slot, and normal seated play never enters this branch at all. Every lookup is nil-guarded
-- and pcall'd, so a stock DLL without these bindings — or any odd state — simply falls through to
-- the requested recipient rather than erroring.
local function readNumber(fn)
    local ok, value = pcall(fn)
    if ok and type(value) == "number" then return value end
    return nil
end

local targetID = playerID
do
    local activeID = readNumber(function() return Game.GetActivePlayer() end)
    if activeID ~= nil and activeID ~= targetID then
        local activePlayer = Players[activeID]
        if activePlayer ~= nil then
            local okObserver, isObserver = pcall(function() return activePlayer:IsObserver() end)
            if okObserver and isObserver then
                local overrideID = readNumber(function() return Game.GetObserverUIOverridePlayer() end)
                if overrideID ~= nil and overrideID == targetID then
                    targetID = activeID
                end
            end
        end
    end
end

local player = Players[targetID]
if player == nil or NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY == nil then
    return false
end

local notificationID = player:AddNotificationName("NOTIFICATION_VOX_DEORUM_DIPLOMACY", message, summary, -1, -1, counterpartID, counterpartID)
return notificationID ~= nil and notificationID >= 0
