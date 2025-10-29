import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'

enum SlotType {
	COURT = 'COURT',
	COACH = 'COACH',
	BALLBOY = 'BALLBOY',
}

// GET /ballboys/availability?startAt=YYYY-MM-DDTHH:mm&endAt=YYYY-MM-DDTHH:mm
export const getAvailableBallboyHandler = factory.createHandlers(
	zValidator('query', availableCoachesQuerySchema, validateHook),
	async (c) => {
		try {
			const { startAt, endAt } = c.req.valid('query') as {
				startAt: string
				endAt: string
			}

			const startDateTime = new Date(startAt)
			const endDateTime = new Date(endAt)

			const slots = await db.slot.findMany({
				where: {
					type: SlotType.BALLBOY,
					startAt: startDateTime,
					endAt: endDateTime,
					isAvailable: true,
					bookingBallboys: { none: {} },
				},
				include: {
					staff: {
						select: {
							id: true,
							name: true,
							email: true,
							phone: true,
							image: true,
							role: true,
						},
					},
				},
				orderBy: { price: 'asc' },
			})

			const ballboys = slots.map((slot) => ({
				slotId: slot.id,
				ballboy: slot.staff,
				price: slot.price,
				startAt: slot.startAt,
				endAt: slot.endAt,
			}))

			return c.json(ok(ballboys), status.OK)
		} catch (error) {
			c.var.logger.fatal(`Error in getAvailableBallboyHandler: ${error}`)
			throw error
		}
	},
)


