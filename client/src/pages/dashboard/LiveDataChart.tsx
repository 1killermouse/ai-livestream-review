import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { LiveMetricPoint } from '@shared/api.interface';

const chartConfig = {
  onlineUsers: {
    label: '在线人数',
    color: '#2563eb',
  },
  interactions: {
    label: '互动量',
    color: '#16a34a',
  },
} satisfies ChartConfig;

interface LiveDataChartProps {
  points: LiveMetricPoint[];
}

const LiveDataChart: React.FC<LiveDataChartProps> = ({ points }) => (
  <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
    <LineChart
      data={points}
      margin={{ top: 16, right: 18, bottom: 8, left: 8 }}
    >
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="timeLabel"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
      />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={42} />
      <ChartTooltip
        cursor={false}
        content={<ChartTooltipContent indicator="line" />}
      />
      <ChartLegend content={<ChartLegendContent />} />
      <Line
        dataKey="onlineUsers"
        type="monotone"
        stroke="var(--color-onlineUsers)"
        strokeWidth={2}
        dot={false}
      />
      <Line
        dataKey="interactions"
        type="monotone"
        stroke="var(--color-interactions)"
        strokeWidth={2}
        dot={false}
      />
    </LineChart>
  </ChartContainer>
);

export default LiveDataChart;
