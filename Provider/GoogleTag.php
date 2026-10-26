<?php
/**
 * Copyright © OOCS Commerce (https://www.oocscommerce.com). All rights reserved.
 * See LICENSE.txt for license details.
 */
declare(strict_types=1);

namespace OOCS\LynxGoogleTag\Provider;

use Magento\GoogleGtag\Model\Config\GtagConfig;
use OOCS\LynxComponent\Model\AbstractComponentProvider;

/**
 * Props of the GA4 node: the measurement id core's Google GTag config holds
 */
class GoogleTag extends AbstractComponentProvider
{
    /**
     * Gtag config
     *
     * @param GtagConfig $gtagConfig
     */
    public function __construct(
        private readonly GtagConfig $gtagConfig,
    ) {
    }

    /**
     * Resolve
     *
     * @param array $props
     * @return array
     */
    public function resolve(array $props): array
    {
        $props['ga4_id'] = $this->gtagConfig->isGoogleAnalyticsAvailable()
            ? $this->gtagConfig->getMeasurementId()
            : '';

        return $props;
    }
}
