var spotifyApi = new SpotifyWebApi()

var queue;
var currentTrack;
var trackCache = {};
var ourIp;
var notificationsAllowed = false;
var loaded = false, firstLoad = true;

var searchPage;

$(function () {
    if (localStorage.getItem("queue") != null)  localStorage.setItem("oldQueue", localStorage.getItem("queue"));

    $.ajaxSetup({
        cache: true
    });
    async.series([loadTemplates, loadPages], function () {
        console.log("Connecting...")
        var socket = window.socket = io('ws://' + window.location.hostname + "/", {transports: ['websocket']});
        socket.on('connect', function () {
            console.log("Connected to server");
        });
        socket.on("reconnect", function () {
            console.log("Reconnected");
            $("body").removeClass("disconnected")
        })
        socket.on("disconnect", function () {
            console.error("Disconnected");
            $("body").addClass("disconnected")
        })

        socket.on("playState", function (playing) {
            console.log("playState", playing)
            $(".play").toggleClass("mdi-av-play-arrow", !playing).toggleClass("mdi-av-pause", !!playing);
            $(".current-playing-btn").toggleClass("mdi-av-play-circle-outline", !playing).toggleClass("mdi-av-pause-circle-outline", !!playing);
        })

        socket.on("ip", function (ip) {
            ourIp = ip;
        });

        socket.on("playQueue", function (_queue) {
            queue = _queue;
            localStorage.setItem("queue", JSON.stringify(queue)); //Save queue (saves from crashes!)
            $(".shuffle-button").toggleClass("active", queue.shuffled)
            $("body").removeClass("play-queue-open");

            if (queue.tracks.length > 0) {
                getTracks(queue.tracks).then(function (tracks) {
                    queue.tracks = tracks;
                    $(".play-queue").html(templates.playQueue({
                        tracks: tracks
                    }));
                })
            } else {
                $(".play-queue ul").html("")
            }
        });
        socket.on("changedCurrent", function (track) {
            if (!track) {
                changedCurrent(track);
                return;
            }
            var id = track.link.split(":")[2];
            if ("undefined" !== typeof trackCache[id]) {
                changedCurrent(trackCache[id]);
            } else {
                spotifyApi.getTrack(id).then(function (_track) {
                    trackCache[id] = _track;
                    changedCurrent(_track);
                });
            }
        });

        socket.on("seek", function (time) {
            $(".duration-slider").val(time);
            $(".current-time").text(formatDuration(time * 1000));
        })

        socket.on("volume", function (volume) {
            volume = Math.pow(volume / 21.5, 3);
            $(".volume").val(volume);
        })
        socket.on("isPhone", function (isPhone) {
            $(".phone-call-on").toggleClass("active", isPhone);
        })

        socket.on("accessToken", function (accessToken) {
            spotifyApi.setAccessToken(accessToken);
            if (!loaded) {
                loaded = true;
                //Load the current page (or default)
                var prom;
                if (window.location.hash != "") {
                    prom = navigateToPath(window.location.hash.slice(1), true);
                } else {
                    prom = navigateTo("browse");
                }
                prom.then(function () {
                    socket.emit("getQueue");
                })
                checkNotifications();
            }
        })
        socket.on("error", function (message) {
            console.log(message);
            doNotification(message, {timeout: 5})
        });
        socket.on("toast", function (data) {
            if ("string" === typeof data) data = {text: data, timeout: 4000};
            Materialize.toast(data.text, data.timeout);
        });
        $(window).on("resize", function () {
            $("main").scroll();
        })
        $("body").on("click", ".show-search-btn", function () {
            $("header").addClass("show-search");

            $(".search-content .search-results").html(templates.searchPage({
                emptySearch: true
            }))
            $("body").addClass("show-search-page")

            $('.search-tabs .tab[data-tab="track"] a').click();
            doSearch($(".search").val());
        }).on("focus", ".search", function () {
            if (!$("body").hasClass("show-search-page")) {
                $('.search-tabs .tab[data-tab="track"] a').click();
                $("body").addClass("show-search-page");
            }
            if ($(this).val() == "") {
                $(".search-content .search-results").html(templates.searchPage({
                    emptySearch: true
                })).addClass("show");
                doSearch($(".search").val());
            }
        }).on("click", ".hide-search-btn", function () {
            $("header").removeClass("show-search");
            $("input.search").val("");
            $("body").removeClass("show-search-page");
        }).on("click", ".close-search-icon", function () {
            $("body").removeClass("show-search-page");
            $("input.search").val("");
        }).on("click", ".show-sidebar-btn", function () {
            $("body").toggleClass("show-left-bar");
        }).on("click", "[data-nav]", function (e) {
            navigateTo($(this).attr("data-nav"));
            $("body").removeClass("show-left-bar show-search-page");
            $("header").removeClass("show-search");
            e.preventDefault();
        }).on("click", function (e) {
            if ($("body").is(".show-left-bar") && $(e.target).is("body")) {
                $("body").removeClass("show-left-bar");
            }
        }).on("click", ".mobile-current-playing", function () {
            $("body").toggleClass("show-mobile-controls");
        }).on("click", ".close-mobile-controls-btn", function () {
            $("body").removeClass("show-mobile-controls").removeClass("show-mobile-queue");
        }).on("click", ".play", function () {
            socket.emit($(this).is(".mdi-av-play-arrow") ? "play" : "pause");
            return false;
        }).on("click", ".current-playing-btn", function () {
            socket.emit($(this).is(".mdi-av-play-circle-outline") ? "play" : "pause");
            return false;
        }).on("click", ".next", function () {
            socket.emit("skip");
            return false;
        }).on("click", ".back", function () {
            socket.emit("skipBack");
            return false;
        }).on("change", ".volume", function () {
            var val = parseInt($(this).val());
            socket.emit("setVolume", Math.pow(val, 1 / 3) * 21.5);
        }).on("click", ".shuffle-button", function () {
            socket.emit("toggleShuffle", !$(this).hasClass("active"));
        }).on("change", ".duration-slider", function () {
            socket.emit("seek", parseInt($(this).val()));
        }).on("keypress", ".search", debounce(function () {
            doSearch($(this).val());
        }, 1000)).on("click", ".search-tabs .search-tab", function () {
            searchPage = $(this).attr("data-tab");
            doSearch($(".search").val())
            return false;
        }).on("click", "[data-uri][data-action]", function (e) {
            $(".track-popup").remove();
            $("header").removeClass("show-search");
            $(".context-menu").remove();

            handleURIAction.call(this, $(this).attr("data-action"), $(this).attr("data-uri"), $(this).parents(".track-table").attr("data-uri"), e)
            return false;
        }).on("click", "[data-action]", function (e) {
            $(".track-popup").remove();
            $("header").removeClass("show-search");
            $(".context-menu").remove();

            handleAction.call(this, $(this).attr("data-action"));
            return false;
        }).on("dblclick", "[data-uri][data-double-action]", function () {
            $(".track-popup").remove();
            handleURIAction.call(this, $(this).attr("data-double-action"), $(this).attr("data-uri"), $(this).parents(".track-table").attr("data-uri"))
            return false;
        }).on("mousedown", "[data-uri][data-double-action]", function (e) {
            if (e.which == 1) return false;
        }).on("click", ".phone-call-on", function () {
            socket.emit("phoneOn");
            return false;
        }).on("click", ".phone-call-off", function () {
            socket.emit("phoneOff");
            return false;
        }).on("click", "aside.play-queue .votes .vote-btn", function () {
            socket.emit("vote", {uuid: $(this).parents("li").attr("data-uuid"), up: $(this).is(".up")})
        }).on("keypress", function (e) {
            var $target = $(e.target);
            if ($target.is("input,textarea,button,select") && !$target.is("input[type='range']")) return true;
            if (e.which == 32) { //Space
                $("button.play").click();
                return false;
            }
        }).on("click", function () {
            $(".context-menu").remove();
        }).on("click", ".mobile-show-queue", function () {
            $("body").toggleClass("show-mobile-queue");
        }).on("click", "aside.play-queue li", function () {
            var open = $(this).is(".open");
            var $this = $(this);
            var $paper = $(this).children("paper-material")
            $("aside.play-queue li.open").each(function () {
                var $this = $(this);
                $this.addClass("close");
                $this.css("top", 0)
                setTimeout(function () {
                    $this.removeClass("open close").children("paper-material").attr("elevation", 1)
                    if ($("aside.play-queue li.open").length == 0) {
                        $("body").removeClass("play-queue-open");
                        $("aside.play-queue ul").css("top", "")
                    }
                }, 500)
            })
            if (!open) {
                $this.addClass("open").removeClass("loaded");
                $paper.attr("elevation", 2)
                if (!$("body").is(".play-queue-open"))
                    $("aside.play-queue ul").css("top", -$("aside.play-queue").scrollTop())
                $("body").addClass("play-queue-open")

                if ($this.offset().top + 290 > $(window).height()) {
                    $this.css("top", 0);
                    setTimeout(function () {
                        $this.css("top", $(window).height() - ($this.offset().top + 290));
                    })
                }


                var track = queue.tracks.filter(function (val) {
                    return val.uuid == $this.attr("data-uuid")
                })[0];
                $this.find(".extra-content .cover-art").attr("src", track.album.images[0].url)
                handleURIAction("get", track.source).then(function (source) {
                    $this.find(".source strong").html($("<a>").attr("data-action", "view").attr("data-uri", source.uri).text(source.name))
                    $this.addClass("loaded");
                })
            }
        }).on("mousedown mousemove", ".no-highlight", function (e) {
            e.stopPropagation();
            return false;
        })

        registerContextMenu(".track-table .track-item, .play-queue li", function () {
            return getTracks([$(this).attr("data-uri").split(":")[2]]).then(function (tracks) {
                var track = tracks[0];

                var options = [
                    {
                        type: "text",
                        icon: "av:queue-music",
                        text: "Add to queue",
                        action: "add",
                        uri: track.uri
                    }, {
                        type: "text",
                        icon: "av:play-arrow",
                        text: "Play Next",
                        action: "addNext",
                        uri: track.uri
                    },
                    {
                        type: "separator"
                    },
                    {
                        type: "text",
                        text: "View Artist",
                        action: "view",
                        uri: track.artists[0].uri
                    },
                    {
                        type: "text",
                        text: "View Album",
                        action: "view",
                        uri: track.album.uri
                    }
                ];
                if ($(this).is("[data-uuid]")) {
                    var uuid = $(this).attr("data-uuid");
                    queue.tracks.forEach(function (dataTrack) {
                        if (dataTrack.uuid == uuid && dataTrack.source.split(":")[1] == "user") {
                            options.push({
                                type: "text",
                                text: "View Playlist",
                                action: "view",
                                uri: dataTrack.source
                            });
                        }
                    })
                }

                return options;

            }.bind(this))
        });

        $('ul.tabs').tabs();

        window.addEventListener("popstate", function (e) {
            if (e.state && e.state.page) {
                navigateTo(e.state.page, e.state.args, true);
            } else {
                navigateToPath(window.location.hash.slice(1), true);
            }
        })
    })
});
function changedCurrent(track) {
    currentTrack = track;
    if (!track) {
        $(".length").text("00:00");
        $(".current-title, .current-artist").text("");
    } else {
        $(".duration-slider").attr("max", Math.round(track.duration_ms / 1000))
        if (currentPage == "nowPlaying") navigateTo(currentPage); //Refresh the now playing page
        $(".length").text(formatDuration(track.duration_ms));
        $(".current-art").attr("src", track.album.images[0].url);
        $(".current-title").text(track.name);

        $(".current-artist").html("");
        track.artists.forEach(function (artist) {
            $(".current-artist").append($("<a>").text(artist.name).attr({'data-action': "view", 'data-uri': artist.uri}));
        })
        $(".current-album").html($("<a>").text(track.album.name).attr({'data-action': 'view', 'data-uri': track.album.uri}));

        doNotification("Now playing", {
            tag: "nowPlaying",
            body: track.name,
            icon: track.album.images[0].url,
            timeout: 10
        });
    }
}

function handleAction(action) {
    var $target = $(this);
    if ($(this).is("[data-target]")) {
        $target = $(this).parents($(this).attr("data-target"));
    }

    switch (action) {
        case "contextmenu":
            $target.trigger({
                type: 'contextmenu',
                clientX: $(this).offset().left,
                clientY: $(this).offset().top
            });
            break;
    }
}

function handleURIAction(action, uri, data, e) {
    var split = action.split("|");
    if (split.length == 2) {
        if (split[0] == "clear") socket.emit("clearQueue");
        action = split[split.length - 1];
    }

    if ("undefined" === typeof  e) {
        e = {};
    } else {
        radiateDelayFrom(e.clientX, e.clientY);
    }

    var type = uri.split(":")[1];
    if (type == "user") type = "playlist"; //Assuming we're not going to use playlists

    if (action == "addNext") {
        action = "add";
        e.shiftKey = true;
    }

    if (action == "add") {
        switch (type) {
            case "artist":
                //Wat
                break;
            case "album":
                socket.emit("addAlbum", uri);
                break;
            case "track":
                var alreadyIn = false;
                queue.tracks.forEach(function (track) {
                    if (track.uri == uri) alreadyIn = true;
                })
                if (!alreadyIn || confirm("This track is already in the queue, do you want to add it again?"))
                    socket.emit(e.shiftKey === true ? "addNext" : "addTrack", {uri: uri, source: data});
                break;
            case "playlist":
                socket.emit("addPlaylist", uri);
                break;
        }
    } else if (action == "view") {
        var prom;
        switch (type) {
            case "artist":
                prom = navigateTo("viewArtist", {uri: uri});
                break;
            case "album":
                prom = navigateTo("viewAlbum", {uri: uri});
                break;
            case "track":
                prom = navigateTo("viewTrack", {uri: uri});
                break;
            case "playlist":
                prom = navigateTo("viewPlaylist", {uri: uri});
                break;
            case "category":
                prom = navigateTo("viewCategory", {id: uri.split(":")[2]});
                break;
            default:
                return;
        }
        $("body").removeClass("show-search-page");
        if ("object" === typeof this && $(this).is(".pill")) {
            var $this = $(this);
            $(this).css({
                top: $(this).offset().top,
                left: $(this).offset().left,
                height: $(this).height(),
                width: $(this).width()
            }).addClass("pill-clicked").before("<div class='pill'>");
            $("body").append($this);

            setTimeout(function () {
                $this.css({
                    width: $("main").width(),
                    height: 300,
                    left: $("main").offset().left,
                    top: $("main").offset().top
                })
                prom.then(function () {
                    $this.addClass("fade-out");
                    setTimeout(function () {
                        $this.remove();
                    }, 200)
                }, function () {
                    $this.remove();
                })
            })
        }
    } else if (action == "get") {
        switch (type) {
            case "artist":
                return spotifyApi.getArtist(uri.split(":").pop());
            case "playlist":
                var splitUri = uri.split(":");
                return spotifyApi.getPlaylist(splitUri[2], splitUri.pop());
        }
    }
}

function doSearch(val) {
    if (val.length < 2) {
        $(".search-content .search-results").html(templates.searchPage({emptySearch: true}));
        return;
    } else {
        $(".search-content .search-results").html(templates.searchPage({
            loading: true
        }));
    }
    if (searchPage == "track") {
        spotifyApi.searchTracks(val, {market: "GB"}).then(function (results) {
            $(".search-content .search-results").html(templates.searchPage({
                tracks: results.tracks.items
            }));
        });
    } else if (searchPage == "album") {
        spotifyApi.searchAlbums(val, {market: "GB"}).then(function (results) {
            colorizeItems($(".search-content .search-results").html(templates.searchPage({
                albums: results.albums.items
            })));
        })
    } else if (searchPage == "artist") {
        spotifyApi.searchArtists(val, {market: "GB"}).then(function (results) {
            colorizeItems($(".search-content .search-results").html(templates.searchPage({
                artists: results.artists.items
            })));
        })
    } else if (searchPage == "playlist") {
        spotifyApi.searchPlaylists(val, {market: "GB"}).then(function (results) {
            colorizeItems($(".search-content .search-results").html(templates.searchPage({
                playlists: results.playlists.items
            })));
        })
    }
}

function navigateToPath(path, noPush) {
    var hashSplit = path.split("?");
    var args = undefined;
    if (hashSplit.length == 2) {
        var vars = hashSplit[1].split("&");
        var args = {};
        vars.forEach(function (val) {
            var split = val.split("=");
            args[decodeURIComponent(split[0])] = decodeURIComponent(split[1]);
        })
    }
    return navigateTo(hashSplit[0], args, noPush);
}

function navigateTo(_page, args, noPush) {
    return new Promise(function (resolve, reject) {
        function addContent() {
            var $page = $(page.template(data));
            new Promise(function (resolve) {
                resolve($page);
            }).then(function ($page) {
                    return "function" === typeof page.callbacks.beforeAppend ? page.callbacks.beforeAppend($page) : $page;
                }).then(function ($page) {
                    $("main").attr("class", "").html($page);
                }).then(function () {
                    return "function" === typeof page.callbacks.afterAppend ? page.callbacks.afterAppend($page) : $page;
                }).then(function () {
                    radiateDelayFrom(0, 0)
                    return "function" === typeof page.callbacks.after ? page.callbacks.after($page) : $page;
                }).then(function () {
                    $("main").addClass("animate-in")
                    resolve();
                })

        }

        console.log("Loading page %s", _page, args);
        var samePage = _page == currentPage, finishedAnimating = false, loaded = false, data, animTimeout = false;

        var page = pages[_page];
        if ("undefined" == typeof page) {
            console.log("Invalid page: %s", _page);
            showErrorPage("Couldn't load the page", "An invalid page was selected");
            reject();
            return;
        }
        $("main").addClass("animate-out").removeClass("animate-in")
        if ($(window).width() > 600 && firstLoad === false) {
            animTimeout = setTimeout(function () {
                if ("undefined" !== typeof previousPage && "function" === typeof previousPage.callbacks.destroy) previousPage.callbacks.destroy($("main"));

                $("main").html(templates.pageLoader());
                finishedAnimating = true
                $("body,html").animate({scrollTop: 0}, 10);
                previousPage = page;
                if (loaded) {
                    addContent();
                }
            }, 600);
        } else {
            $("main").html(templates.pageLoader());
            finishedAnimating = true;
        }
        firstLoad = false;
        currentPage = page.name;

        page.fn(args).then(function (_data) {
            data = _data;
            loaded = true;
            if (finishedAnimating) addContent();
        }, function (e) {
            if (animTimeout) clearTimeout(animTimeout);
            showErrorPage("Couldn't load the page", e);
            reject();
        })
        $("ul.left-nav li a[data-nav]").removeClass("selected").filter("[data-nav='" + currentPage + "']").addClass("selected");

        samePage || noPush || history.pushState({
            page: _page,
            args: args
        }, false, "#" + _page + ("undefined" != typeof args ? "?" + $.param(args) : ""));
    })
}

function registerPage(name, fn, template, callbacks) {
    if ("object" !== typeof callbacks) callbacks = {};
    pages[name] = {
        name: name,
        fn: fn,
        template: template,
        callbacks: callbacks
    }
}

var pages = {};
var templates = {};
var currentPage;
var previousPage;


function formatDuration(ms) {
    var totalSeconds = Math.round(ms / 1000);
    var seconds = totalSeconds % 60;
    var minutes = Math.floor(totalSeconds / 60) % 60;
    var hours = Math.floor(totalSeconds / (60 * 60));

    return (hours > 0 ? hours + ":" : "") + padString(minutes, 2) + ":" + padString(seconds, 2);
}
function formatTimestamp(ms) {
    if (!ms) return;
    var date = new Date(ms);
    return timeSince(date) + " ago";
}

function ifCond(a, b, options) {
    if (a === b) {
        return options.fn(this);
    }
    return options.inverse(this);
}

function timeSince(date) {

    var seconds = Math.floor((new Date() - date) / 1000);

    var interval = Math.floor(seconds / 31536000);

    if (interval > 1) {
        return interval + " years";
    }
    interval = Math.floor(seconds / 2592000);
    if (interval > 1) {
        return interval + " months";
    }
    interval = Math.floor(seconds / 86400);
    if (interval > 1) {
        return interval + " days";
    }
    interval = Math.floor(seconds / 3600);
    if (interval > 1) {
        return interval + " hours";
    }
    interval = Math.floor(seconds / 60);
    if (interval > 1) {
        return interval + " minutes";
    }
    return Math.floor(seconds) + " seconds";
}

function loadTemplates(cb) {
    var loaded = false;

    console.groupCollapsed("Loading Templates");
    Handlebars.registerHelper("duration", formatDuration)
    Handlebars.registerHelper("timestamp", formatTimestamp)
    Handlebars.registerHelper("ifCond", ifCond);
    $.getJSON("/templates.json").then(function (data) {
        async.parallel([
            function (cb) {
                async.map(data.templates, function (name, cb) {
                    $.get("/templates/" + name + ".hbs").then(function (data) {
                        templates[name] = Handlebars.compile(data);
                        console.log("Compiled %s", name)
                        cb();
                    })
                }, cb)
            },
            function (cb) {
                async.map(data.partials, function (name, cb) {
                    $.get("/templates/partials/" + name + ".hbs").then(function (data) {
                        Handlebars.registerPartial(name, data);
                        console.log("Compiled fragment %s", name)
                        cb();
                    })
                }, cb)
            }], function () {
            console.groupEnd();
            loaded = true;
            cb();
        });
    });

    setTimeout(function () {
        if (!loaded) {
            alert("A problem occurred loading the templates. Reloading...")
            window.location.reload();
        }
    }, 8 * 1000);
}

function padString(value, width, padWith) {
    padWith = padWith || '0';
    value = '' + value;
    return value.length >= width ? value : new Array(width - value.length + 1).join(padWith) + value;
}

function loadPages(cb) {
    var loaded = false;
    console.groupCollapsed("Loading pages");
    $.getJSON("/pages.json").then(function (pages) {
        async.map(pages, function (name, cb) {
            console.log("Loading page %s", name)
            $.getScript("/js/pages/" + name).then(function () {
                console.log("Loaded page %s", name)
                cb();
            }, function () {
                doNotification("Couldn't load page " + name, {timeout: 5})
            });
        }, function () {
            loaded = true;
            console.groupEnd();
            cb();
        })
    });

    setTimeout(function () {
        if (!loaded) {
            alert("A problem occurred loading the pages. Reloading...")
            window.location.reload();
        }
    }, 8 * 1000);
}

function doNotification(title, args, callback) {
    if (notificationsAllowed) {
        if (!callback) callback = $.noop;
        var notification = new Notification(title, args);
        callback(notification);
        if ("undefined" !== typeof args.timeout) {
            setTimeout(function () {
                notification.close();
            }, args.timeout * 1000)
        }
    }
}

function checkNotifications() {
    try {
        if (localStorage.getItem("notificationsAllowed") == null) {
            Notification.requestPermission(function (data) {
                notificationsAllowed = data == "granted";
                localStorage.setItem("notificationsAllowed", notificationsAllowed);
            });
        } else {
            notificationsAllowed = localStorage.getItem("notificationsAllowed") == "true";
        }
    } catch (e) {
        notificationsAllowed = false;
    }
}

function getTracks(uris) {
    return new Promise(function (resolve, reject) {
        if (uris.length == 0) resolve([]); //Don't do nought for an empty list...
        var uncachedTracks = uris.filter(function (track) {
            return "undefined" == typeof trackCache["string" === typeof track ? track : track.id]
        })
        var tracksSplit = [];
        var i, chunk = 50;
        for (i = 0; i < uncachedTracks.length; i += chunk) {
            uncachedTracks.slice(i, i + chunk);
            tracksSplit.push(uncachedTracks.slice(i, i + chunk).map(function (track) {
                return "string" === typeof track ? track : track.id;
            }));
        }
        async.each(tracksSplit, function (item, cb) {
            spotifyApi.getTracks(item).then(function (result) {
                result.tracks.forEach(function (track) {
                    if (track == null) return;
                    trackCache[track.id] = track;
                });
                cb();
            })
        }, function () {
            var tracks = uris.map(function (track) {
                if ("object" === typeof track) {
                    var _track = $.extend({}, trackCache[track.id]); //Make a copy;
                    _track.source = track.source;
                    _track.votes = track.votes;
                    _track.uuid = track.uuid;
                    _track.votesIps = track.votesIps;
                    _track.vote = "undefined" == typeof track.votesIps[ourIp] ? 0 : track.votesIps[ourIp]
                    _track.votedUp = _track.vote == 1;
                    _track.votedDown = _track.vote == -1;
                    _track.forcedTop = track.forcedTop;
                } else {
                    var _track = $.extend({}, trackCache[track]);
                }
                return _track;
            });

            resolve(tracks)
        })
    });
}


function registerContextMenu(selector, cb) {
    $("body").on("contextmenu", selector, function (e) {
        if (e.shiftKey) {
            return true;
        }

        $(".context-menu").remove();
        Promise.all([cb.apply(this, arguments)]).then(function (items) {
            var $menu = $(templates.contextMenu({items: items[0]}));

            var $window = $(window);
            $("body").append($menu);

            $menu.css({
                top: Math.min($window.height() - $menu.outerHeight(), e.clientY),
                left: Math.min($window.width() - $menu.outerWidth() - 10, e.clientX)
            })
        })
        return false;
    });
}

function radiateDelayFrom(x, y) {
    $(".radiate-delay").each(function () {
        var $this = $(this), pos = $this.position();
        var delay = this.delay = Math.pow(Math.pow(pos.left - x + $(this).width() / 2, 2) + Math.pow(pos.top - y + $(this).height() / 2, 2), 0.5) / 5;
        $(this).css("animation-delay", this.delay + "ms");
    });
}

$.fn.redraw = function () {
    $(this).each(function () {
        var redraw = this.offsetHeight;
    });
    return this;
};

function debounce(func, wait, immediate) {
    var timeout;
    return function () {
        var context = this, args = arguments;
        var later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

var colorCache;
if (!localStorage.getItem("colorCache")) {
    colorCache = {};
} else {
    colorCache = JSON.parse(localStorage.getItem("colorCache"));
}
function getAverageColor(url) {
    return new Promise(function (resolve) {
        if ("undefined" !== typeof colorCache[url]) {
            //Cached color
            resolve(colorCache[url]);
            return;
        }
        var colorThief = new ColorThief();

        if (url.indexOf("https://u.scdn.co") !== -1) url = url.replace("https://u.scdn.co/images/pl/default/", "https://i.scdn.co/image/");

        var image = new Image;
        image.crossOrigin = "Anonymous";
        image.onload = function () {
            var start = (new Date).getTime();

            try {
                var color = colorThief.getColor(image);
            } catch (e) {
                console.error("Couldn't get color!", url, e)
                resolve([207, 216, 220]);
                return
            }
            colorCache[url] = color;
            localStorage.setItem("colorCache", JSON.stringify(colorCache));
            var end = (new Date).getTime();

            console.debug("getAverageColor", url, end - start + "ms")

            resolve(color);
        }
        image.onerror = function () {
            console.error(arguments)
            resolve([207, 216, 220]);
            return;
        }
        image.src = url;
    })
}


function colorizeItems($page) {
    var promises = [];
    $page.find(".colorize").each(function () {
        var $img = $(this).find("img");
        promises.push(getAverageColor($img.is("[data-src]") ? $img.attr("data-src") : $img.attr("src")).then(function (color) {
            var darkText = (1 - ( 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]) / 255) < 0.5;
            $(this).attr("style", function (s) {
                return (!s ? "" : s) + " background-color: rgb(" + color.join() + ") !important;"
            }).toggleClass("dark-text", darkText)
        }.bind(this)))
    })
    return Promise.all(promises).then(function () {
        return $page;
    });
}

function animateDetailPage() {
    if ($("body").width() > 992) {
        var progress = Math.min($(this).scrollTop() / 150, 1), inverseProgress = 1 - progress;
        $(this).find(".view-detail-top .image-wrap img").css("max-height", 150 + inverseProgress * 150);
        $(this).find(".view-detail-top .image-wrap").css("max-width", 150 + inverseProgress * 150);
        $(this).find(".view-detail-top").css("height", 150 + inverseProgress * 150);
        $(this).find(".view-detail-top h4, .view-detail-top .buttons-wrap").css("opacity", inverseProgress);
        $(this).find(".view-detail-top h3").css("margin-top", progress * -27);
    } else {
        $(this).find(".view-detail-top .image-wrap img").css("max-height", "");
        $(this).find(".view-detail-top .image-wrap").css("max-width", "");
        $(this).find(".view-detail-top").css("height", "");
        $(this).find(".view-detail-top h4, .view-detail-top .buttons-wrap").css("opacity", "");
        $(this).find(".view-detail-top h3").css("margin-top", "");
    }
}

function showErrorPage(title, e) {
    var message = e;
    if (!("string" === typeof message)) {
        if (e instanceof XMLHttpRequest) {
            var response = e.response;
            try {
                response = JSON.parse(response);

                message = response.error.message;
            } catch (e) {
                message = response;
            }
        } else if ("object" === typeof message && "string" === typeof message.message) {
            if ("string" === typeof message.title) title = message.title;
            message = message.message;
        } else {
            message = JSON.stringify(message).replace(/\\n/g, "<br>").replace(/\\/g, "");
        }
    }

    $("main").html(templates.errorPage({title: title, message: message}));
}

function throttle(fn, threshhold, scope) {
    threshhold || (threshhold = 250);
    var last,
        deferTimer;
    return function () {
        var context = scope || this;

        var now = +new Date,
            args = arguments;
        if (last && now < last + threshhold) {
            // hold on to it
            clearTimeout(deferTimer);
            deferTimer = setTimeout(function () {
                last = now;
                fn.apply(context, args);
            }, threshhold);
        } else {
            last = now;
            fn.apply(context, args);
        }
    };
}
