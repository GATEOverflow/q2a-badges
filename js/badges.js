/* Q2A Badges */

document.addEventListener('DOMContentLoaded', () => {
	
	/**
	 * Badge State Manager (lightweight singleton/centralized cache layer)
	 *
	 * Stores and restores badge popup list state per badgeSlug.
	 * This avoids unnecessary refetching and preserves:
	 * - Rendered HTML (list items)
	 * - Pagination offset
	 * - Completion state (done flag)
	 *
	 * Behaves like a small in-memory state store scoped to this module.
	 */
	const badgeState = (() => {
		const cache = new Map();

		return {
			// Get cached state for a badge
			get(slug) {
				return cache.get(slug) || null;
			},

			// Save current list state
			set(slug, container) {
				cache.set(slug, {
					html: container.innerHTML,
					offset: container.dataset.offset ?? '0',
					done: container.dataset.done ?? 'false'
				});
			},
			
			// Apply cached state to a container
			// @returns {boolean} true if applied
			apply(slug, container) {
				const state = cache.get(slug);
				if (!state) return false;

				container.innerHTML = state.html;
				container.dataset.offset = state.offset;
				container.dataset.done = state.done;

				return true;
			},
			
			// Check if state exists
			has(slug) {
				return cache.has(slug);
			},
			
			// Clear cached state for a badge
			clear(slug) {
				cache.delete(slug);
			}
		};
	})();
	
	/* =========================
		Debug helper (optional)
		Expose badge state in DevTools:
		window.badgeStateDebug.get('popular_question')
	========================= */
	// window.badgeStateDebug = badgeState;
	
	/**
	 * UI helper: Handle clicks on any .qa-badge-count-link
	 * If Admin option is to not show sources, this class is not rendered in DOM
	 */
	document.body.addEventListener('click', (e) => {
		if (e.target && e.target.matches('.qa-badge-count-link')) {
			const options = {
				badgeSlug: e.target.dataset.slug,
				type: e.target.dataset.typeSlug,
				name: e.target.dataset.name,
				popupTitle: e.target.dataset.popupTitle || null,
				desc: e.target.dataset.desc,
				fetchUrlBase: e.target.dataset.fetchUrl,
				userId: e.target.dataset.userid || 0,
			};
			
			loadBadgeSourceUsers(options);
			
			// Trigger theme-specific lazy loading update if available
			// Polaris theme includes a `lazyLoadInstance` globally for images.
			// This ensures newly added badge avatars are picked up without breaking other themes.
			lazyLoadInstance?.update?.();
			
			document.body.classList.add('no-scroll');
		}
	});
	
	/**
	 * Loads and displays the badge source users popup for a given badge.
	 * Creates the container if it doesn't exist, restores from cache if available,
	 * initializes lazy loading on scroll, and triggers the first load of badge entries.
	 *
	 * @param {Object} options - Badge info including slug, badge type, name, popupTitle, description, fetch URL, and user ID.
	 */
	const loadBadgeSourceUsers = ({
		badgeSlug,
		type,
		name,
		popupTitle,
		desc,
		fetchUrlBase,
		userId = 0
	}) => {
		let container = document.getElementById('qa-badge-users-' + badgeSlug);
		const badgeLink = document.querySelector(`.qa-badge-count-link[data-slug="${badgeSlug}"]`);
		if (!badgeLink) return;
		
		const popupTitleCheck = popupTitle != null ? `<span class="bsh-title">${popupTitle}:</span>` : '';
		
		const htmlContent = `
			<div class="qa-badge-source-container">
				<div class="qa-badge-source-header flex flex-row">
					<div class="qa-badge-source-info flex flex-column">
						<div class="bsh-container">
							${popupTitleCheck}
							<span class="qa-badge-${type}">${name}</span>
							<span class="qa-badge-source-title-description">${desc}</span>
						</div>
					</div>
					<div class="bsh-container">
						<div class="qa-badge-close-btn flex noSelect">✕</div>
					</div>
				</div>
				<ul class="qa-badge-sources-wrapper" data-slug="${badgeSlug}" data-offset="0" data-fetchurl="${fetchUrlBase}" data-userid="${userId}"></ul>
				<div class="qa-badge-loading-spinner">
					<span class="qa-badge-spinner">
						<div class="bubble-loader">
							<svg viewBox="0 0 120 30" width="60" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle class="dot" cx="15" cy="15" r="6" />
								<circle class="dot" cx="60" cy="15" r="6" />
								<circle class="dot" cx="105" cy="15" r="6" />
							</svg>
						</div>
					</span>
				</div>
			</div>
			<div class="qa-badge-close-source noSelect"></div>
		`;

		if (!container) {
			// Dynamically create the container and insert it after the .qa-badge-count-link
			container = document.createElement('div');
			container.id = 'qa-badge-users-' + badgeSlug;
			container.className = 'qa-badge-container-sources';
			
			// If already cached, use it instead of rebuilding
			if (badgeState.has(badgeSlug)) {

				container.innerHTML = htmlContent;
				
				// Restore from cache
				const list = container.querySelector('.qa-badge-sources-wrapper');

				if (badgeState.apply(badgeSlug, list)) {
					badgeLink.parentElement.appendChild(container);

					// Reattach scroll listener and continue lazy load
					loadOnScroll(container, badgeSlug);
					// Spinner cleanup
					showLoadingSpinner(false);

					container.dataset.loaded = 'true';
					container.classList.add('qa-badge-show-source');

					return;
				}
			}
			
			badgeLink.parentElement.appendChild(container);
		}

		if (!container.dataset.loaded) {
			
			container.innerHTML = htmlContent;
			loadMoreBadgeEntries(badgeSlug);
			
			// If reached the bottom of the element, load more badges
			loadOnScroll(container, badgeSlug);
		}
		
		container.classList.add('qa-badge-show-source');
	};
	
	/**
	 * Event listener: Handle reconnection when the browser comes back online.
	 * Updates any existing badge error messages to indicate success and
	 * triggers a refresh of badge entries that previously failed to load.
	 */
	window.addEventListener('online', () => {
		document.querySelectorAll('.qa-badge-error-message').forEach(msg => {
			msg.textContent = 'Connection restored. Loading...';
			msg.classList.remove('error');
			msg.classList.add('success');
		});

		document.querySelectorAll('.qa-badge-sources-wrapper').forEach(wrapper => {
			const slug = wrapper.dataset.slug;

			if (wrapper.querySelector('.qa-badge-error-message')) {
				loadMoreBadgeEntries(slug);
			}
		});
	});

	/**
	 * Fetches more badge entries asynchronously and appends them to the badge source list.
	 * Manages loading state, pagination offset, loading spinner, error handling,
	 * and caches fully loaded content for quick subsequent access.
	 *
	 * @param {string} badgeSlug - The unique badge identifier.
	 */
	const loadMoreBadgeEntries = badgeSlug => {
		const container = document.querySelector(`#qa-badge-users-${badgeSlug} .qa-badge-sources-wrapper`);
		if (!container) return;
		
		// Skips execution on localhost/127.0.0.1 to avoid misleading
		// "you're back online" messages during local development.
		if (!navigator.onLine && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
			// container.innerHTML = '';
			container.dataset.loading = 'false';
			showUserErrorMessage(
				container,
				'You are offline. Please reconnect and try again.',
				'error'
			);
			return;
		}

		if (container.dataset.loading === 'true' || container.dataset.done === 'true') return;

		// Show spinner for every fetch attempt
		showLoadingSpinner(true);
		
		container.dataset.loading = 'true';

		const offset = parseInt(container.dataset.offset || '0', 10);
		const limit = 15;
		const fetchUrlBase = container.dataset.fetchurl;
		const userId = container.dataset.userid || 0;

		if (!fetchUrlBase) {
			console.error('Missing fetch URL base for badge:', badgeSlug);
			container.dataset.loading = 'false';
			return;
		}
		
		let fetchFrom = `${fetchUrlBase}/badges-endpoint/render-page-badges.php`;
		
		if (document.body.classList.contains('qa-template-user')) {
			fetchFrom = `${fetchUrlBase}/badges-endpoint/render-profile-badges.php`;
		}
		
		const fetchUrl = `${fetchFrom}?slug=${encodeURIComponent(badgeSlug)}&userid=${userId}&offset=${offset}&limit=${limit}`;
		// console.log(fetchUrl); // Uncomment for debug
		
		fetch(fetchUrl, {
			headers: {
				'X-Requested-With': 'Fetch'
			}
		})
		.then(res => {
			if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
			return res.text();
		})
		.then(html => {
			if (html.trim()) {
				container.insertAdjacentHTML('beforeend', html);
				container.dataset.offset = offset + limit;
			} else {
				container.dataset.done = 'true';
			}

			// Cache the *fully loaded* badge content
			const wrapper = container.closest('.qa-badge-container-sources');
			if (wrapper) {
				badgeState.set(badgeSlug, container);
				wrapper.dataset.loaded = 'true';
			}
		})
		.catch(err => {
			console.error('Failed to load more badge users:', err);
			showUserErrorMessage(container, 'Failed to load badge users. Please try again.');
		})
		.finally(() => {
			const error = container.querySelector('.qa-badge-error-message');
			if (error) {
				error.remove();
			}

			container.dataset.loading = 'false';

			// After content is loaded, check if scrollable and cache if not
			// Othewise it will keep calling short lists
			setTimeout(() => {
				const wrapper = container.closest('.qa-badge-container-sources');
				if (wrapper) {
					const scrollContainer = wrapper.querySelector('.qa-badge-sources-wrapper');
					
					// Ensure scrollContainer exists and check if it's scrollable
					if (scrollContainer && isNotScrollable(scrollContainer)) {
						// Cache the content as it's fully loaded
						wrapper.dataset.loaded = 'true';
						badgeState.set(badgeSlug, container);
						// console.log('NOT scrollable');
						// console.log('cached');
					}
				}
			}, 260); // wait for the popup animations to finish, to get the full exapanded size (animation is .25s)
			
			setTimeout(() => {
				showLoadingSpinner(false);
			}, 500);

			if (typeof window.lazyLoadInstance !== 'undefined' && typeof window.lazyLoadInstance.update === 'function') {
				window.lazyLoadInstance.update();
			}

			badgeAdaptAvatar();
		});
	};
	
	// UI helper: show error message inside container
	const showUserErrorMessage = (container, message, type = 'error') => {
		if (!container) return;
		
		let errorElem = container.querySelector('.qa-badge-error-message');

		if (!errorElem) {
			errorElem = document.createElement('div');
			errorElem.className = 'qa-badge-error-message';
			container.appendChild(errorElem);
		}

		errorElem.textContent = message;

		errorElem.classList.remove('error', 'success');
		errorElem.classList.add(type);
	};
	
	// UI helper: Load more Badges, on scroll
	const loadOnScroll = (container, badgeSlug) => {
		const scrollContainer = container.querySelector('.qa-badge-sources-wrapper');

		if (scrollContainer && !scrollContainer.dataset.listenerAttached) {
			scrollContainer.dataset.listenerAttached = 'true';

			scrollContainer.addEventListener('scroll', () => {
				if (
					scrollContainer.scrollTop + scrollContainer.clientHeight >=
					scrollContainer.scrollHeight - 20
				) {
					loadMoreBadgeEntries(badgeSlug);
				}
			});
		}
	};
	
	/**
	 * Check if the element is scrollable.
	 * @param {HTMLElement} element - The DOM element to check.
	 * @return {boolean} - True if the element is scrollable, false otherwise.
	 */
	const isNotScrollable = element => {
		return element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth;
	};
	
	// UI helper: show/hide loading spinner
	const showLoadingSpinner = show => {
		document.querySelectorAll('.qa-badge-loading-spinner').forEach(spinner => {
			spinner.classList.toggle('active', show);
		});
	};
	
	// UI helper: Badge Sources cleanup
	document.body.addEventListener('click', event => {
		if (
			event.target.matches('.qa-badge-close-btn') ||
			event.target.matches('.qa-badge-close-source')
		) {
			document.querySelectorAll('.qa-badge-container-sources').forEach(container => container.remove());
			document.body.classList.remove('no-scroll');
		}
	});
	
	/**
	 * UI helper:
	 * Adds the class "wide-image" to avatar images whose width exceeds their height,
	 * enabling CSS-based styling for wide images to maintain aspect ratio consistency.
	 */
	const badgeAdaptAvatar = () => {
		const qaAvatarImages = document.querySelectorAll('.qa-avatar-image');

		qaAvatarImages.forEach((img) => {
			if (img.complete) {
				// If image already loaded, check now
				checkAndAddClass(img);
			} else {
				img.addEventListener('load', () => checkAndAddClass(img));
			}
		});

		function checkAndAddClass(img) {
			if (img.offsetWidth > img.offsetHeight) {
				img.classList.add('wide-image');
			}
		}
	};
	
	// UI helper: Scroll body to earned badge
	if (window.location.href.indexOf('badges') > -1) {
		const targetElement = document.querySelector('body.qa-template-user div.qa-part-form-badges-list');
		if (targetElement) {
			window.scrollTo({
				top: targetElement.getBoundingClientRect().top + window.pageYOffset,
				behavior: 'smooth'
			});
		}
	}
	
});
